import { Link } from "react-router-dom";
import { ArrowUpRight, Heart } from "lucide-react";
import CreatorLink from "./CreatorLink";
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="perspective-grid" aria-hidden="true" />
      <div className="footer-inner">
        <div className="footer-top">
          <div>
            <span className="eyebrow">A LITTLE HELP. A BETTER SEMESTER.</span>
            <h2>
              Built for the
              <br />
              <span>next batch.</span>
            </h2>
          </div>
          <Link to="/contact" className="button secondary">
            Pass something forward <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="footer-columns">
          <div className="footer-about">
            <Link className="brand" to="/">
              <img src="/branding/crest.webp" alt="" width="42" height="42" />
              <span>
                <strong>
                  BUIT<span className="accent">PAPERS</span>
                </strong>
                <small>BARKATULLAH UNIVERSITY</small>
              </span>
            </Link>
            <p>
              A student-built collection of past papers
              <br />
              and shared understanding. Open to everyone.
            </p>
          </div>
          <nav aria-label="Footer library">
            <span>THE ARCHIVE</span>
            <Link to="/papers">Question papers</Link>
            <Link to="/notes">Short notes</Link>
            <Link to="/contact?request=true">
              Request a paper <ArrowUpRight size={13} />
            </Link>
          </nav>
          <nav aria-label="Footer community">
            <span>THE COMMUNITY</span>
            <Link to="/about">Our story</Link>
            <Link to="/contact">Contribute & contact</Link>
            <Link to="/copyright">Copyright & takedown</Link>
          </nav>
        </div>
        <div className="footer-wordmark" aria-hidden="true">
          BUIT / PAPERS
        </div>
        <div className="footer-bottom">
          <span>
            Made with <Heart size={11} /> by <CreatorLink /> & team · Bhopal
          </span>
          <span>
            Unofficial student resource. <Link to="/privacy">Privacy</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
