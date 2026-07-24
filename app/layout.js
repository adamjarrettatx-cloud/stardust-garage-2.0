import './globals.css';
import Navbar from './components/Navbar';
import NavbarVisibility from './components/NavbarVisibility';
import CosmosBackground from './components/CosmosBackground';

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

const THEME_KEY = 'sdg-theme';

// Runs synchronously before paint so there's never a flash of the wrong
// theme. Reads localStorage (falls back to the OS preference on first
// visit) and sets data-theme on <html> before React hydrates.
const NO_FLASH_THEME_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('${THEME_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body>
        <CosmosBackground />
        <div className="relative z-10">
          <NavbarVisibility>
            <Navbar />
          </NavbarVisibility>
          {children}
        </div>
      </body>
    </html>
  );
}
