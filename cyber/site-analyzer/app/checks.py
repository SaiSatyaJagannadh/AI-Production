"""Evidence about one website. Each check returns a dict and reports its own failure
as {"error": ...} instead of raising, so one dead source never sinks the report."""

import asyncio
import ipaddress
import json
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 CyberSiteAnalyzer/1.0"
)
MAX_PAGE_BYTES = 2_000_000
MAX_SCRIPT_BYTES = 500_000
MAX_SCRIPTS = 5
RULES = Path(__file__).parent / "rules.yml"
PULLPUSH = "https://api.pullpush.io/reddit/search"
# comments about buying from the site outrank merely popular ones that happen to name it
TRUST_WORDS = re.compile(
    r"(?i)\b(legit|scam\w*|fraud|fake|ordered?|orders|bought|purchase\w*|refund\w*|shipping|shipped|"
    r"arrived|delivery|delivered|customer service|quality|return(ed|s)?|charged|trust\w*|reviews?)\b"
)
# "click my link" invite-code posts flood shopping-app threads and say nothing about trust
REFERRAL_SPAM = re.compile(r"(?i)(/s/\w{6,}|\bup[bv]ote\b|\bclick (mine|yours|my link)\b|\bfish away\b|\breferral\b|\binvite code\b|\bcode:)")


class UnsafeTarget(ValueError):
    """The address points somewhere this server must not be made to fetch."""


def normalize(raw: str) -> str:
    """Turn what a visitor typed into an absolute http(s) URL on a default port."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Enter a website address.")
    if "://" not in raw:
        raw = "https://" + raw
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("That doesn't look like a website address.")
    if p.username or p.password:
        raise ValueError("Addresses with a username or password are not allowed.")
    try:
        port = p.port
    except ValueError:
        raise ValueError("That address has an invalid port.") from None
    if port not in (None, 80, 443):
        raise UnsafeTarget("Only standard web ports (80 and 443) can be analyzed.")
    host = p.hostname.lower().rstrip(".")
    if "." not in host:
        raise ValueError("Include the full domain, for example shop.example.com.")
    query = f"?{p.query}" if p.query else ""
    return f"{p.scheme}://{host}{p.path or '/'}{query}"


def check_public(host: str) -> list[str]:
    """Resolve host and refuse anything that is not a public internet address.

    Stops the analyzer being pointed at localhost, the cloud metadata server or a
    private network. Called for every request, redirects included.
    """
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError(f"The domain {host} does not resolve - it may not exist.") from None
    ips = sorted({info[4][0] for info in infos})
    for ip in ips:
        if not ipaddress.ip_address(ip.split("%")[0]).is_global:
            raise UnsafeTarget(f"{host} points to a private address and can't be analyzed.")
    # ponytail: re-resolved at connect time, so DNS rebinding can slip past; pin IPs if this ever leaves demo use
    return ips


def domain_candidates(host: str) -> list[str]:
    """shop.example.co.uk -> [shop.example.co.uk, example.co.uk, co.uk]; RDAP is tried longest first."""
    labels = host.removeprefix("www.").split(".")
    return [".".join(labels[i:]) for i in range(len(labels) - 1)]


def brand_label(host: str) -> str:
    """The part a person would type into Reddit: 'temu' for www.temu.com."""
    labels = host.removeprefix("www.").split(".")
    if len(labels) >= 3 and len(labels[-2]) <= 3:  # second-level suffixes like co.uk, com.au
        return labels[-3]
    return labels[-2] if len(labels) >= 2 else labels[0]


async def _guard(request: httpx.Request) -> None:
    if request.url.port not in (None, 80, 443):
        raise UnsafeTarget("Redirect to a non-standard port blocked.")
    await asyncio.to_thread(check_public, request.url.host)


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"},
        timeout=httpx.Timeout(12.0),
        follow_redirects=True,
        max_redirects=8,
        event_hooks={"request": [_guard]},
    )


async def _read_capped(response: httpx.Response, limit: int) -> str:
    chunks, size = [], 0
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= limit:
            break
    return b"".join(chunks)[:limit].decode(response.encoding or "utf-8", errors="replace")


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title, self.description = "", ""
        self.script_srcs: list[str] = []
        self.inline_scripts: list[str] = []
        self.form_actions: list[str] = []
        self.has_password = False
        self._in_title = self._in_script = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and a.get("name", "").lower() == "description":
            self.description = a.get("content", "")[:300]
        elif tag == "script":
            if a.get("src"):
                self.script_srcs.append(a["src"])
            else:
                self._in_script = True
                self.inline_scripts.append("")
        elif tag == "form":
            self.form_actions.append(a.get("action", ""))
        elif tag == "input" and a.get("type", "").lower() == "password":
            self.has_password = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_script = False

    def handle_data(self, data):
        if self._in_title and len(self.title) < 200:
            self.title += data
        elif self._in_script:
            self.inline_scripts[-1] += data


def parse_page(html: str, base_url: str) -> dict:
    p = PageParser()
    try:
        p.feed(html)
    except Exception:  # malformed markup still yields whatever was parsed so far
        pass
    base_host = urlparse(base_url).hostname
    external_forms = sorted(
        {urlparse(urljoin(base_url, a)).hostname for a in p.form_actions if a.strip()} - {base_host, None}
    )
    return {
        "title": " ".join(p.title.split()),
        "description": p.description,
        "has_password_field": p.has_password,
        "forms_posting_elsewhere": external_forms,
        "script_srcs": [urljoin(base_url, s) for s in p.script_srcs],
        "inline_scripts": [s for s in p.inline_scripts if s.strip()],
    }


async def fetch_page(url: str, client: httpx.AsyncClient) -> dict:
    async with client.stream("GET", url) as r:
        html = await _read_capped(r, MAX_PAGE_BYTES)
        h = r.headers
        page = {
            "status": r.status_code,
            "final_url": str(r.url),
            "redirects": [str(x.url) for x in r.history],
            "https": r.url.scheme == "https",
            "hsts": "strict-transport-security" in h,
            "csp": "content-security-policy" in h,
            "x_frame_options": "x-frame-options" in h,
            "server": h.get("server", ""),
            "bytes": len(html),
        }
    parsed = parse_page(html, page["final_url"])
    files = {"page.html": html}
    for i, s in enumerate(parsed.pop("inline_scripts")[:50]):
        files[f"inline-{i}.js"] = s
    srcs = parsed.pop("script_srcs")
    page["script_count"] = len(srcs)
    page["script_hosts"] = sorted({urlparse(s).hostname or "" for s in srcs} - {""})[:15]

    async def grab(src: str) -> str:
        try:
            async with client.stream("GET", src) as r:
                return await _read_capped(r, MAX_SCRIPT_BYTES) if r.status_code == 200 else ""
        except Exception:
            return ""

    for i, body in enumerate(await asyncio.gather(*(grab(s) for s in srcs[:MAX_SCRIPTS]))):
        if body:
            files[f"external-{i}.js"] = body
    return page | parsed | {"files": files}


def tls_info(host: str) -> dict:
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=8) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as tls:
                cert, version = tls.getpeercert(), tls.version()
    except ssl.SSLCertVerificationError as e:
        return {"valid": False, "error": e.verify_message or "certificate failed verification"}
    except OSError as e:
        return {"valid": False, "error": str(e) or type(e).__name__}
    expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), timezone.utc)
    issued = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notBefore"]), timezone.utc)
    issuer = dict(x[0] for x in cert["issuer"])
    subject = dict(x[0] for x in cert["subject"])
    return {
        "valid": True,
        "issuer": issuer.get("organizationName") or issuer.get("commonName", ""),
        "subject": subject.get("commonName", ""),
        "organization": subject.get("organizationName", ""),  # only present on OV/EV certificates
        "issued": issued.date().isoformat(),
        "expires": expires.date().isoformat(),
        "days_left": (expires - datetime.now(timezone.utc)).days,
        "protocol": version,
    }


def parse_rdap(data: dict) -> dict:
    events = {e.get("eventAction"): e.get("eventDate", "") for e in data.get("events", [])}
    registrar = ""
    for ent in data.get("entities", []):
        if "registrar" in ent.get("roles", []):
            for field in (ent.get("vcardArray") or [None, []])[1]:
                if field[0] == "fn":
                    registrar = field[3]
    created = events.get("registration", "")
    age_days = None
    if created:
        age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(created.replace("Z", "+00:00"))).days
    return {
        "domain": data.get("ldhName", "").lower(),
        "created": created[:10],
        "expires": events.get("expiration", "")[:10],
        "updated": events.get("last changed", "")[:10],
        "age_days": age_days,
        "registrar": registrar,
        "status": data.get("status", []),
    }


_rdap_servers: dict[str, str] = {}


async def rdap_servers(client: httpx.AsyncClient) -> dict[str, str]:
    """TLD -> its registry's RDAP base URL, from IANA's bootstrap file (fetched once per process)."""
    if not _rdap_servers:
        r = await client.get("https://data.iana.org/rdap/dns.json")
        for tlds, urls in r.json().get("services", []):
            base = next((u for u in urls if u.startswith("https://")), urls[0])
            _rdap_servers.update({t.lower(): base.rstrip("/") for t in tlds})
    return _rdap_servers


async def rdap_lookup(host: str, client: httpx.AsyncClient) -> dict:
    # Ask the registry itself first: rdap.org sits behind Cloudflare, which turns away cloud IPs.
    try:
        servers = await rdap_servers(client)
    except Exception as e:
        print(f"rdap bootstrap failed: {e!r}", flush=True)
        servers = {}
    for domain in domain_candidates(host):
        base = servers.get(domain.rsplit(".", 1)[-1])
        for url in filter(None, [base and f"{base}/domain/{domain}", f"https://rdap.org/domain/{domain}"]):
            try:
                r = await client.get(url, timeout=25, headers={"Accept": "application/rdap+json"})  # registries are slow
            except httpx.HTTPError as e:
                print(f"rdap {url}: {e!r}", flush=True)
                continue
            if r.status_code == 200:
                return parse_rdap(r.json())
            if r.status_code != 404:
                print(f"rdap {url}: HTTP {r.status_code}", flush=True)
    return {"error": "No registration record found (some country domains don't publish RDAP)."}


def pick_comments(raw: list[dict], label: str, limit: int = 6) -> list[dict]:
    """Highest-scored comments that actually talk about the site, removed/deleted ones dropped."""
    seen, out = set(), []
    shopper = lambda c: bool(TRUST_WORDS.search(c.get("body") or ""))  # noqa: E731
    for c in sorted(raw, key=lambda c: (shopper(c), c.get("score", 0)), reverse=True):
        body = (c.get("body") or "").strip()
        key = " ".join(body.lower().split())
        if key in seen or body in ("[removed]", "[deleted]") or len(body) < 25 or REFERRAL_SPAM.search(body):
            continue
        if label.lower() not in key:
            continue
        seen.add(key)
        out.append({
            "body": body[:600],
            "score": c.get("score", 0),
            "subreddit": c.get("subreddit", ""),
            "url": "https://www.reddit.com" + c.get("permalink", ""),
            "date": datetime.fromtimestamp(c.get("created_utc", 0), timezone.utc).date().isoformat(),
        })
        if len(out) == limit:
            break
    return out


async def reddit_mentions(host: str, client: httpx.AsyncClient) -> dict:
    domain = host.removeprefix("www.")
    label = brand_label(host)

    async def search(kind: str, q: str) -> list[dict]:
        try:
            r = await client.get(
                f"{PULLPUSH}/{kind}/", params={"q": q, "size": 50, "sort_type": "score", "sort": "desc"}
            )
            if r.status_code == 200:
                return r.json().get("data", [])
            print(f"pullpush {kind} {q!r}: HTTP {r.status_code}", flush=True)
        except Exception as e:
            print(f"pullpush {kind} {q!r}: {e!r}", flush=True)
        return []

    legit, scam, plain, posts = await asyncio.gather(
        search("comment", f"{domain} legit"),
        search("comment", f"{domain} scam"),
        search("comment", domain),
        search("submission", domain),
    )
    threads = [
        {
            "title": p.get("title", "")[:200],
            "score": p.get("score", 0),
            "comments": p.get("num_comments", 0),
            "subreddit": p.get("subreddit", ""),
            "url": "https://www.reddit.com" + p.get("permalink", ""),
        }
        for p in sorted(posts, key=lambda p: p.get("score", 0), reverse=True)
        if label.lower() in (p.get("title", "") + p.get("selftext", "")).lower()
    ][:4]
    return {"comments": pick_comments(legit + scam + plain, label), "threads": threads}


def parse_semgrep(stdout: str) -> list[dict]:
    findings = []
    for r in json.loads(stdout).get("results", []):
        extra = r.get("extra", {})
        findings.append({
            "rule": r.get("check_id", "").rsplit(".", 1)[-1],
            "severity": extra.get("severity", "INFO"),
            "message": extra.get("message", "")[:300],
            "file": Path(r.get("path", "")).name,
            "line": r.get("start", {}).get("line", 0),
            "snippet": (extra.get("lines") or "").strip()[:200],
        })
    order = {"ERROR": 0, "WARNING": 1, "INFO": 2}
    return sorted(findings, key=lambda f: order.get(f["severity"], 3))[:25]


def semgrep_scan(files: dict[str, str]) -> dict:
    exe = shutil.which("semgrep")
    if not exe:
        return {"ran": False, "error": "Semgrep is not installed on this server.", "findings": []}
    if not files:
        return {"ran": False, "error": "No page content to scan.", "findings": []}
    with tempfile.TemporaryDirectory() as d:
        for name, text in files.items():
            (Path(d) / name).write_text(text, encoding="utf-8")
        cmd = [exe, "scan", "--config", str(RULES), "--json", "--quiet", "--metrics=off", "--timeout", "20", d]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return {"ran": False, "error": "Semgrep timed out.", "findings": []}
    try:
        findings = parse_semgrep(p.stdout)
    except json.JSONDecodeError:
        return {"ran": False, "error": (p.stderr or "Semgrep failed.")[-300:], "findings": []}
    return {"ran": True, "files_scanned": len(files), "findings": findings}


async def _safe(coro) -> dict:
    try:
        return await coro
    except UnsafeTarget as e:
        return {"error": str(e)}
    except httpx.TooManyRedirects:
        return {"error": "Too many redirects."}
    except httpx.HTTPError as e:
        return {"error": f"{type(e).__name__}: {e}"[:200] or type(e).__name__}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"[:200]}


async def gather_evidence(url: str) -> dict:
    host = urlparse(url).hostname
    ips = await asyncio.to_thread(check_public, host)
    async with make_client() as client:
        page, rdap, reddit, tls = await asyncio.gather(
            _safe(fetch_page(url, client)),
            _safe(rdap_lookup(host, client)),
            _safe(reddit_mentions(host, client)),
            _safe(asyncio.to_thread(tls_info, host)),
        )
    semgrep = await asyncio.to_thread(semgrep_scan, page.pop("files", {}))
    return {
        "url": url,
        "host": host,
        "ips": ips,
        "page": page,
        "tls": tls,
        "domain": rdap,
        "reddit": reddit,
        "semgrep": semgrep,
    }
