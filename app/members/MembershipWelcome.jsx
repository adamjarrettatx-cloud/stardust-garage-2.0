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
        <h1>Find the membership that fits you.</h1>
        <p className="intro">
          A place to work, a reason to go out, a community to connect with.
          Tell us what brings you to Stardust Garage, and we’ll help you find
          your fit.
        </p>
        <Link className="primary" href="/members?start=1" data-testid="button-start-quiz">
          Find my fit <span aria-hidden="true">→</span>
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
