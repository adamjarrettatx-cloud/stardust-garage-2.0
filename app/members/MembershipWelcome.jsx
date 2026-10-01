import Link from 'next/link';
import Wordmark from '@/app/components/Wordmark';
import './quiz.css';

export default function MembershipWelcome() {
  return (
    <div className="membership-quiz">
      <header className="header">
        <Link href="/home" className="brand" aria-label="Stardust Garage home">
          <Wordmark />
        </Link>
        <Link href="/home" className="text-button">Back to site</Link>
      </header>
      <main className="quiz-main welcome-main">
        <h1>Find your kind of Stardust.</h1>
        <p className="intro">
          Workdays, weekend nights, and everything in between. Answer a few
          questions about how you’d like to spend your time here, and we’ll help
          you find the membership that fits you.
        </p>
        <Link className="primary" href="/members?start=1" data-testid="button-start-quiz">
          Find my membership <span aria-hidden="true">→</span>
        </Link>
        <p className="footnote">Your results will be saved to your Stardust account.</p>
      </main>
      <footer className="footer">
        <span>AUSTIN, TEXAS</span>
        <span><Link href="/account/profile">My account</Link> · <Link href="/privacy">Privacy</Link></span>
      </footer>
    </div>
  );
}
