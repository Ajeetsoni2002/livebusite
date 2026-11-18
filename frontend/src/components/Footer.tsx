import { Link } from "react-router-dom";
import { ArrowUpRight, Heart } from "lucide-react";
import CreatorLink from "./CreatorLink";
import { EarnSticky } from "./Earn";

/* Social profiles from VITE_SOCIAL_LINKS (comma-separated); also used as sameAs in the
   Organization schema by scripts/prerender.mjs. */
const socialNames: [RegExp, string][] = [
  [/instagram\.com/, "Instagram"],
  [/(t\.me|telegram\.)/, "Telegram"],
  [/(youtube\.com|youtu\.be)/, "YouTube"],
  [/linkedin\.com/, "LinkedIn"],
  [/whatsapp\.com/, "WhatsApp channel"],
  [/^(x|twitter)\.com$/, "X (Twitter)"],
  [/facebook\.com/, "Facebook"],
  [/github\.com/, "GitHub"],
];
const socialLinks = String(import.meta.env.VITE_SOCIAL_LINKS || "")
  .split(",")
  .map((link) => link.trim())
  .filter((link) => /^https:\/\/[^\s"<>]+$/.test(link))
  .map((link) => {
    const host = new URL(link).hostname.replace(/^www\./, "");
    return {
      link,
      name: socialNames.find(([pattern]) => pattern.test(host))?.[1] || host,
    };
  });

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
        <div
          className={`footer-columns ${socialLinks.length ? "with-social" : ""}`}
        >
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
            <Link to="/syllabus">B.Tech syllabus</Link>
            <Link to="/contact?request=true">
              Request a paper <ArrowUpRight size={13} />
            </Link>
          </nav>
          <nav aria-label="Footer community">
            <span>THE COMMUNITY</span>
            <Link to="/contribute">Become a contributor · earn ₹15</Link>
            <Link to="/jobs">Jobs &amp; internships</Link>
            <Link to="/contributor/login">Contributor login</Link>
            <Link to="/contributors">Top contributors</Link>
            <Link to="/about">Our story</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/copyright">Copyright & takedown</Link>
          </nav>
          {socialLinks.length > 0 && (
            <nav aria-label="Follow BUIT Papers">
              <span>FOLLOW US</span>
              {socialLinks.map(({ link, name }) => (
                <a key={link} href={link} target="_blank" rel="noopener me">
                  {name} <ArrowUpRight size={13} />
                </a>
              ))}
            </nav>
          )}
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
