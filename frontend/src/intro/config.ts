/** Everything the intro says. Edit here; the rest of the module reads only this. */
export const introConfig = {
  siteName: "BUIT Papers",
  /** Dot-matrix text spelled by the OMR bubbles (A–Z, 0–9, space, "." and "-"). */
  bubbleText: "BUIT PAPERS",
  university: "Barkatullah University",
  universityShort: "BUIT",
  tagline: "Your next exam. A little easier.",
  /** Year flaps run from here up to the current year. */
  yearFrom: 2015,
  /** Subject row (max 16 characters each, upper-case reads best). The last one is where it lands. */
  subjects: [
    "B.TECH CSE",
    "DBMS",
    "DATA STRUCTURE",
    "COMPILER DESIGN",
    "B.TECH IT",
    "MACHINE LEARNING",
    "THEORY OF COMP.",
    "COMPUTER NETWORK",
    "B.TECH ECE",
    "DIGITAL ELEC.",
    "ENGG. MATHS II",
    "SOFT COMPUTING",
    "B.TECH EE",
    "ENGG. PHYSICS",
    "DATA SCIENCE",
    "B.TECH ME",
    "INTERNET OF THNG",
    "BIG DATA",
    "B.TECH CE",
    "ALL SUBJECTS",
  ],
  /** "Indexing papers…" counts up to this. Currently the real published total from the snapshot. */
  paperCount: 52,
  stamp: "EXAM READY",
  stampSub: "ALL THE BEST",
};

export type IntroConfig = typeof introConfig;
