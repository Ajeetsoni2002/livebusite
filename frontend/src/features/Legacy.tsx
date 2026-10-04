import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
export default function Legacy() {
  const location = useLocation(),
    navigate = useNavigate(),
    [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/legacy-map.json")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((mapping) => {
        if (!active) return;
        const target = mapping[decodeURIComponent(location.pathname)];
        if (target) navigate(target, { replace: true });
        else setMissing(true);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
    };
  }, [location.pathname, navigate]);
  return (
    <main className="page">
      <h1>{missing ? "Resource link unavailable" : "Opening the archive…"}</h1>
      <p>
        {missing
          ? "Browse the preserved library to find this resource."
          : "Finding the current resource page."}
      </p>
      <Link className="button" to="/papers">
        Browse papers
      </Link>
    </main>
  );
}
