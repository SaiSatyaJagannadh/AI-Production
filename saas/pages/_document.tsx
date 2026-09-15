import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta
          name="description"
          content="MediNotes Pro turns consultation notes into a record summary, follow-up steps and a patient-friendly email."
        />
        <meta name="theme-color" content="#0e7c74" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a1116" media="(prefers-color-scheme: dark)" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
