import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { RATE, rupees, promoDismissed, dismissPromo } from "../lib/earn";

/** The offer as a pay order: the clearest way to say "we pay you". */
export function EarnCheque({
  heading = true,
  n,
}: {
  heading?: boolean;
  n?: number;
}) {
  const [papers, setPapers] = useState(10),
    [notes, setNotes] = useState(5);
  const id = useId();
  return (
    <section className="eh-cheque" aria-labelledby={`${id}-title`}>
      {heading && (
        <div className="eh-q-head">
          <span className="eh-q-num">Q.{n}</span>
          <h2 id={`${id}-title`}>
            Turn your old papers into{" "}
            <mark className="eh-mark">pocket money.</mark>
          </h2>
          <span className="eh-marks">[{RATE} marks each]</span>
        </div>
      )}
      <div className="eh-cheque-body">
        <div className="eh-cheque-top">
          <span>BUIT STUDENT PAY ORDER</span>
          <span>No. 0000{RATE}</span>
          <span>
            Date: <i className="eh-hand">on every approval</i>
          </span>
        </div>
        <p className="eh-cheque-line">
          <span>PAY</span>
          <i className="eh-hand">you — any BUIT student</i>
          <span>OR BEARER</span>
        </p>
        <p className="eh-cheque-line">
          <span>RUPEES</span>
          <i className="eh-hand">
            ten only, for every approved paper &amp; note
          </i>
          <strong className="eh-cheque-amount" aria-label={`${RATE} rupees`}>
            ₹ {RATE}/-
          </strong>
        </p>
        <div className="eh-calc">
          <label htmlFor={`${id}-papers`}>
            Papers you can upload <output>{papers}</output>
          </label>
          <input
            id={`${id}-papers`}
            type="range"
            min={0}
            max={60}
            value={papers}
            onChange={(e) => setPapers(Number(e.target.value))}
          />
          <label htmlFor={`${id}-notes`}>
            Notes you can upload <output>{notes}</output>
          </label>
          <input
            id={`${id}-notes`}
            type="range"
            min={0}
            max={60}
            value={notes}
            onChange={(e) => setNotes(Number(e.target.value))}
          />
          <p className="eh-calc-total" aria-live="polite">
            You could earn <strong>{rupees((papers + notes) * RATE)}</strong>
          </p>
        </div>
        <div className="eh-cheque-foot">
          <Link className="button" to="/contribute">
            Become a contributor <ArrowRight size={17} />
          </Link>
          <span className="eh-signature">
            <i className="eh-hand">BUIT Papers</i>
            <small>AUTHORISED SIGNATORY</small>
          </span>
        </div>
      </div>
    </section>
  );
}

/** A sticky note that links to the contributor page. */
export function EarnSticky({
  title = `${rupees(RATE)} per paper!`,
  text = `Got old question papers or notes? Upload them and earn ${rupees(RATE)} for every approved one.`,
  className = "",
}: {
  title?: string;
  text?: string;
  className?: string;
}) {
  return (
    <Link to="/contribute" className={`eh-sticky ${className}`}>
      <span className="eh-tape" aria-hidden="true" />
      <strong className="eh-hand">{title}</strong>
      <span>{text}</span>
      <span className="eh-sticky-cta">
        Become a contributor <ArrowRight size={15} />
      </span>
    </Link>
  );
}

const quiet = /^\/(?:contribute|contributor|admin|auth)(?:\/|$)/;

/** The thin offer line above the navigation, on every public page. */
export function EarnRibbon() {
  const { pathname } = useLocation();
  if (quiet.test(pathname)) return null;
  return (
    <Link to="/contribute" className="eh-ribbon">
      <span className="eh-ribbon-badge">EARN</span>
      <span>
        <strong>{rupees(RATE)}</strong> for every approved paper or note you
        upload.
      </span>
      <span className="eh-ribbon-cta">
        Become a contributor <ArrowRight size={14} />
      </span>
    </Link>
  );
}

/** A note that slides in after some scrolling; closing it hides it for three days. */
export function EarnFloater() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false),
    [closed, setClosed] = useState(promoDismissed);
  useEffect(() => {
    if (closed || quiet.test(pathname)) return;
    const check = () => {
      if (window.scrollY > Math.min(900, innerHeight * 0.9)) setVisible(true);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [closed, pathname]);
  if (closed || !visible || quiet.test(pathname)) return null;
  return (
    <aside className="eh-floater" aria-label="Earn by contributing">
      <button
        className="eh-floater-close"
        aria-label="Close"
        onClick={() => {
          dismissPromo();
          setClosed(true);
        }}
      >
        <X size={15} />
      </button>
      <strong className="eh-hand">Psst… {rupees(RATE)} per paper</strong>
      <span>Your old papers and notes can pay you.</span>
      <Link to="/contribute" className="eh-sticky-cta">
        Start earning <ArrowRight size={15} />
      </Link>
    </aside>
  );
}
