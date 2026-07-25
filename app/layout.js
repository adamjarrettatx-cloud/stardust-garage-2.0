import { Suspense } from 'react';
import './globals.css';
import Navbar from './components/Navbar';
import NavbarVisibility from './components/NavbarVisibility';
import CosmosBackground from './components/CosmosBackground';
import AuthenticatedRouteShell from './components/AuthenticatedRouteShell';
import MailchimpAttribution from './components/MailchimpAttribution';

export const metadata = {
  title: 'Stardust Garage',
  description: 'Underground music venue, cowork space, and creative hub.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Mailchimp's own on-site tracking pixel for this store (auto-created
            when the "stardust_garage" ecommerce store was set up). Powers
            Mailchimp's built-in abandoned-browse/on-site behavior features;
            fully independent of, and a nice-to-have on top of, the
            mc_cid/mc_eid click + Ticket Tailor order attribution built below. */}
        <script
          id="mcjs"
          dangerouslySetInnerHTML={{
            __html: `!function(c,h,i,m,p){m=c.createElement(h),p=c.getElementsByTagName(h)[0],m.async=1,m.src=i,p.parentNode.insertBefore(m,p)}(document,"script","https://chimpstatic.com/mcjs-connected/js/users/2f35fafd0eb753cd9b691177e/e783a1da3d152253632af49c9.js");`,
          }}
        />
      </head>
      <body>
        <Suspense fallback={null}>
          <MailchimpAttribution />
        </Suspense>
        <CosmosBackground />
        <AuthenticatedRouteShell>
          <div className="relative z-10">
            <NavbarVisibility>
              <Navbar />
            </NavbarVisibility>
            {children}
          </div>
        </AuthenticatedRouteShell>
      </body>
    </html>
  );
}
