import { Link } from "react-router-dom";
import { ArrowUpRight, Heart } from "lucide-react";
import CreatorLink from "./CreatorLink";
import { EarnSticky } from "./Earn";

export default function Footer() {
  return (
    <footer className="site-footer eh-footer">
      <div className="footer-inner">
        <p className="eh-end" aria-hidden="true">
          ✱ ✱ ✱ END OF QUESTION PAPER ✱ ✱ ✱
        </p>
        <div className="footer-top">
          <div>
            <h2>
              Built for the <em>next batch.</em>
            </h2>
            <p className="eh-hand eh-footer-note">
              Check that you have attempted all questions. Best of luck!
            </p>
          </div>
          <EarnSticky
            title="Pass it forward, get ₹15"
            text="Every approved paper or note you upload earns you ₹15."
          />
        </div>
        <div className="footer-columns">
          <div className="footer-about">
            <Link className="brand" to="/">
              <img src="/branding/crest.webp" alt="" width="42" height="42" />
              <span>
                <strong>
                  BUIT <span className="accent">Papers</span>
                </strong>
                <small>BARKATULLAH UNIVERSITY · BHOPAL</small>
              </span>
            </Link>
            <p>
              A student-built collection of past papers and shared
              understanding. Open to everyone.
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
            <Link to="/contribute">Become a contributor · earn ₹15</Link>
            <Link to="/contributors">Top contributors</Link>
            <Link to="/about">Our story</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/copyright">Copyright & takedown</Link>
          </nav>
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
