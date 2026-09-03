import "./globals.css";
// Self-hosted fonts (@fontsource): bundled same-origin, no build-time or
// runtime dependency on Google Fonts, and CSP-safe (`font-src 'self'`,
// `style-src 'self' 'unsafe-inline'`). Family names are wired in globals.css.
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Providers } from "@/components/providers";
import { SWRegister } from "@/components/sw-register";

// The document title and the iOS web-app title come from the catalogs, so they
// are copy like any other rather than a constant.
//
// The label under the icon on an installed home screen does NOT come from here:
// it comes from `name`/`short_name` in public/manifest.json, which is a static
// file with no request and therefore no locale. That is only harmless because
// the product name is "Shoppa" in both catalogs. Translate the name one day and
// the manifest has to become a route handler that reads the locale, not another
// string in these two files.
export async function generateMetadata() {
  const t = await getTranslations("metadata");
  return {
    title: t("title"),
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default" as const,
      title: t("title"),
    },
    icons: {
      icon: "/favicon.svg",
      apple: "/icons/icon-180.png",
    },
  };
}

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe4" },
    { media: "(prefers-color-scheme: dark)", color: "#12140f" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

// Light is the default; an explicit stored choice wins.
// Runs before paint to avoid a theme flash. Inline script is allowed
// by the CSP's `script-src 'self' 'unsafe-inline'`.
const themeBootstrap = `try{if(localStorage.getItem('compra-theme')==='dark'){document.documentElement.setAttribute('data-theme','dark')}}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read per request from the NEXT_LOCALE cookie (src/i18n/request.ts), so the
  // document's language matches the messages the tree is about to render.
  const locale = await getLocale();

  // Only what the browser needs. Left to itself the provider serialises the
  // whole catalog into every page's payload, and `api.*` is server-only — the
  // wording of a 409, of every WebAuthn refusal, of the Telegram alerts. None
  // of it is ever read on the client, and shipping it makes the payload bigger
  // and tells anyone reading the HTML more about the server than they need.
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    Object.entries(messages).filter(([namespace]) => namespace !== "api"),
  );

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased">
        <SWRegister />
        <NextIntlClientProvider messages={clientMessages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--ink)",
              color: "var(--bg)",
              border: "none",
              borderRadius: "13px",
              fontWeight: "600",
            },
          }}
        />
      </body>
    </html>
  );
}
