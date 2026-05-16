import { makeDraggable, addMinimizer } from "./draggable.js";
import { clamp } from "./utils.js";

const PREF_ENDPOINT = "/api/mpo/users/@me/preferences";
const STORE_KEY = "mo_reactive_color_matrix_presets_v2";
const TD = (typeof TextDecoder !== "undefined") ? new TextDecoder() : null;

const PALETTE_LIBRARY = {
  inferno: ["#180000", "#6f0000", "#ff1800", "#ff6a00", "#ffc400", "#fff45a"],
  royal: ["#070015", "#23005a", "#6616d8", "#c73cff", "#ffb000", "#fff2a0"],
  spectrum: ["#ff003c", "#ff3300", "#ff8a00", "#ffe600", "#67ff00", "#00ffd5", "#008cff", "#553cff", "#b000ff", "#ff3bd5"],
  ghost: ["#e8fbff"],
  velvet: ["#120011", "#50002c", "#a90062", "#ff247d", "#ff8a00", "#ffe05c"],
  aurora: ["#10002b", "#2f00a8", "#0099ff", "#00ffc6", "#62ff77", "#ff4fd8"],
  thunder: ["#050008", "#1b1eff", "#7d00ff", "#ffffff", "#fff200", "#ff0033"],
  prism: ["#ff004c", "#ff7a00", "#ffe600", "#00ff9d", "#00b3ff", "#8a2cff", "#ff3bd5"],
  noir: ["#000000", "#181818", "#777777", "#ffffff"],
  ocean: ["#001029", "#003d7a", "#008cff", "#00e5ff", "#adfff5"],
  acid: ["#0c1400", "#66ff00", "#fff000", "#ff6a00", "#ff00a8"],
  solar: ["#210000", "#900000", "#ff2300", "#ff8a00", "#fff200", "#ffffff"],
  starlight: ["#030012", "#10105a", "#2e6cff", "#9fd8ff", "#ffffff"],
  emerald: ["#00140b", "#005c38", "#00e68a", "#d8ff7a", "#fff7c2"],
  leftRight: ["#ff123f", "#ff7b00", "#ffe600", "#2775ff", "#7a2cff"],
  brass: ["#190800", "#6d2700", "#c76600", "#ffb000", "#fff1a0"],
  ivoryRedBlue: ["#006cff", "#ff1010"],
  handSplit: ["#ff123f", "#ff7b00", "#2b7cff", "#7a2cff"],
  obsidianKeys: ["#f7ead0", "#6d102c"],
  cinema: ["#06020f", "#20104d", "#ff2f5f", "#ffb238", "#fff2b0"],
  neonScanner: ["#00f5ff", "#2166ff", "#8b2cff", "#ff2bd6", "#fff200"],
  monochromeGold: ["#111111", "#2b220e", "#b8892d", "#fff2b0"],
  leftRightElegance: ["#d33b35", "#ffb047", "#316dff", "#9f58ff"]
};

const BUILTIN = {
  royal: {
    name: "Royal",
    config: {
      palette: PALETTE_LIBRARY.royal,
      minNote: 24, maxNote: 96, minAlpha: 90, maxAlpha: 255, sendEveryMs: 330, dynamicRanges: true,
      smoothing: 0.18, smoothColor: true, basePos: 0.12, baseAlpha: 0.78, baseSat: 1.25, baseLight: 1.08,
      rules: [
        { input: "pitch", output: "palette", amount: 1.0, curve: "linear", invert: false },
        { input: "velocity", output: "alpha", amount: 0.95, curve: "contrast", invert: false },
        { input: "density", output: "light", amount: 0.35, curve: "soft", invert: false }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.08, periodMs: 5200 }
    }
  },
  inferno: {
    name: "Inferno",
    config: {
      palette: PALETTE_LIBRARY.inferno,
      minNote: 21, maxNote: 96, minAlpha: 115, maxAlpha: 255, sendEveryMs: 300, dynamicRanges: true,
      smoothing: 0.10, smoothColor: true, basePos: 0.10, baseAlpha: 0.85, baseSat: 1.55, baseLight: 1.18,
      rules: [
        { input: "lowest", output: "palette", amount: 1.0, curve: "linear", invert: false },
        { input: "velocity", output: "alpha", amount: 1.0, curve: "punch", invert: false },
        { input: "velocity", output: "light", amount: 0.55, curve: "contrast", invert: false }
      ],
      pattern: { type: "pulse", output: "light", amount: 0.20, periodMs: 900 }
    }
  },
  spectrum: {
    name: "Spectrum",
    config: {
      palette: PALETTE_LIBRARY.spectrum,
      minNote: 21, maxNote: 108, minAlpha: 100, maxAlpha: 255, sendEveryMs: 260, dynamicRanges: true,
      smoothing: 1, smoothColor: false, basePos: 0, baseAlpha: 0.90, baseSat: 1.45, baseLight: 1.15,
      rules: [
        { input: "pitchClass", output: "palette", amount: 1.0, curve: "linear", invert: false },
        { input: "velocity", output: "alpha", amount: 0.85, curve: "contrast", invert: false },
        { input: "chordSize", output: "light", amount: 0.25, curve: "linear", invert: false }
      ],
      pattern: { type: "off", output: "alpha", amount: 0, periodMs: 1000 }
    }
  },
  ghost: {
    name: "Ghost",
    config: {
      palette: PALETTE_LIBRARY.ghost,
      minNote: 21, maxNote: 108, minAlpha: 0, maxAlpha: 255, sendEveryMs: 260, dynamicRanges: true,
      smoothing: 0.12, smoothColor: true, basePos: 0, baseAlpha: 0.0, baseSat: 0.05, baseLight: 1.80,
      rules: [
        { input: "velocity", output: "alpha", amount: 1.25, curve: "contrast", invert: false },
        { input: "density", output: "light", amount: 0.28, curve: "soft", invert: false }
      ],
      pattern: { type: "breath", output: "alpha", amount: 0.18, periodMs: 2400 }
    }
  },
  velvet: {
    name: "Velvet",
    config: {
      palette: PALETTE_LIBRARY.velvet,
      minNote: 21, maxNote: 108, minAlpha: 30, maxAlpha: 255, sendEveryMs: 260, dynamicRanges: true,
      smoothing: 0.10, smoothColor: true, basePos: 0.12, baseAlpha: 0.65, baseSat: 1.60, baseLight: 1.20,
      rules: [
        { input: "velocity", output: "palette", amount: 1.0, curve: "contrast", invert: false },
        { input: "velocity", output: "alpha", amount: 1.0, curve: "contrast", invert: false },
        { input: "velocity", output: "light", amount: 0.65, curve: "punch", invert: false }
      ],
      pattern: { type: "pulse", output: "alpha", amount: 0.20, periodMs: 1300 }
    }
  },
  aurora: {
    name: "Aurora",
    config: {
      palette: PALETTE_LIBRARY.aurora,
      minNote: 21, maxNote: 108, minAlpha: 35, maxAlpha: 255, sendEveryMs: 380, dynamicRanges: true,
      smoothing: 0.10, smoothColor: true, basePos: 0.10, baseAlpha: 0.45, baseSat: 1.20, baseLight: 1.05,
      rules: [
        { input: "density", output: "palette", amount: 1.0, curve: "soft", invert: false },
        { input: "density", output: "alpha", amount: 0.95, curve: "punch", invert: false },
        { input: "highest", output: "hue", amount: 0.16, curve: "linear", invert: false }
      ],
      pattern: { type: "wave", output: "palette", amount: 0.28, periodMs: 6200 }
    }
  },
  thunder: {
    name: "Thunder",
    config: {
      palette: PALETTE_LIBRARY.thunder,
      minNote: 21, maxNote: 108, minAlpha: 80, maxAlpha: 255, sendEveryMs: 240, dynamicRanges: true,
      smoothing: 1, smoothColor: false, basePos: 0.10, baseAlpha: 0.75, baseSat: 1.8, baseLight: 1.32,
      rules: [
        { input: "tension", output: "palette", amount: 1.0, curve: "contrast", invert: false },
        { input: "tension", output: "alpha", amount: 1.0, curve: "hard", invert: false },
        { input: "spread", output: "light", amount: 0.50, curve: "contrast", invert: false }
      ],
      pattern: { type: "strobe", output: "light", amount: 0.42, periodMs: 720 }
    }
  },
  prism: {
    name: "Prism",
    config: {
      palette: PALETTE_LIBRARY.prism,
      minNote: 21, maxNote: 108, minAlpha: 95, maxAlpha: 255, sendEveryMs: 300, dynamicRanges: true,
      smoothing: 0.18, smoothColor: true, basePos: 0.20, baseAlpha: 0.78, baseSat: 1.45, baseLight: 1.12,
      rules: [
        { input: "chordHash", output: "palette", amount: 1.0, curve: "linear", invert: false },
        { input: "chordSize", output: "alpha", amount: 0.90, curve: "contrast", invert: false },
        { input: "velocity", output: "light", amount: 0.35, curve: "soft", invert: false }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.18, periodMs: 3800 }
    }
  },
  chaos: {
    name: "Chaos",
    config: {
      palette: PALETTE_LIBRARY.spectrum,
      minNote: 21, maxNote: 108, minAlpha: 130, maxAlpha: 255, sendEveryMs: 250, dynamicRanges: true,
      smoothing: 1, smoothColor: false, basePos: 0, baseAlpha: 0.85, baseSat: 1.85, baseLight: 1.35,
      rules: [
        { input: "chordHash", output: "palette", amount: 0.85, curve: "linear", invert: false },
        { input: "tension", output: "hue", amount: 0.35, curve: "contrast", invert: false },
        { input: "density", output: "alpha", amount: 1.0, curve: "hard", invert: false },
        { input: "velocity", output: "light", amount: 0.60, curve: "punch", invert: false }
      ],
      pattern: { type: "blink", output: "palette", amount: 0.40, periodMs: 520 }
    }
  }
};


BUILTIN.ivoryEbony = {
  name: "Ivory / Ebony",
  config: {
    palette: ["#f4efe2", "#1b1b24", "#ffffff", "#000000"],
    minNote: 21, maxNote: 108, minAlpha: 90, maxAlpha: 255, sendEveryMs: 280, dynamicRanges: true,
    smoothing: 0.12, smoothColor: true, basePos: 0.25, baseAlpha: 0.78, baseSat: 1.15, baseLight: 1.08,
    rules: [
      { input: "blackKeys", output: "palette", amount: 1.2, curve: "contrast", invert: false },
      { input: "whiteKeys", output: "light", amount: 0.45, curve: "soft", invert: false },
      { input: "velocity", output: "alpha", amount: 0.9, curve: "contrast", invert: false }
    ],
    pattern: { type: "breath", output: "alpha", amount: 0.10, periodMs: 1800 }
  }
};

BUILTIN.ivoryEbonyStrict = {
  name: "Obsidian Keys",
  config: {
    palette: PALETTE_LIBRARY.obsidianKeys,
    minNote: 21, maxNote: 108, minAlpha: 140, maxAlpha: 255, sendEveryMs: 250, dynamicRanges: false,
    smoothing: 1, smoothColor: false, basePos: 0, baseAlpha: 0.88, baseSat: 1.55, baseLight: 1.20,
    harmonyMode: "active", arpeggioWindowMs: 120,
    rules: [
      { input: "currentKey", output: "hardPalette", amount: 1.0, curve: "hard", invert: false },
      { input: "velocity", output: "alpha", amount: 0.65, curve: "contrast", invert: false },
      { input: "velocity", output: "light", amount: 0.25, curve: "punch", invert: false }
    ],
    pattern: { type: "off", output: "alpha", amount: 0, periodMs: 1000 }
  }
};
BUILTIN.leftRightStrict = {
  name: "Split Stage",
  config: {
    palette: PALETTE_LIBRARY.leftRightElegance,
    minNote: 21, maxNote: 108, minAlpha: 120, maxAlpha: 255, sendEveryMs: 260, dynamicRanges: true,
    smoothing: 0.10, smoothColor: true, basePos: 0.50, baseAlpha: 0.78, baseSat: 1.55, baseLight: 1.12,
    harmonyMode: "hybrid", arpeggioWindowMs: 650,
    rules: [
      { input: "keyboardSide", output: "palette", amount: 1.10, curve: "contrast", invert: false },
      { input: "velocity", output: "alpha", amount: 0.85, curve: "contrast", invert: false },
      { input: "spread", output: "light", amount: 0.35, curve: "soft", invert: false }
    ],
    pattern: { type: "wave", output: "hue", amount: 0.06, periodMs: 3600 }
  }
};

BUILTIN.dualHands = {
  name: "Dual Hands",
  config: {
    palette: ["#ff123f", "#ff7b00", "#ffe600", "#2775ff", "#7a2cff"],
    minNote: 21, maxNote: 108, minAlpha: 95, maxAlpha: 255, sendEveryMs: 280, dynamicRanges: true,
    smoothing: 0.10, smoothColor: true, basePos: 0.40, baseAlpha: 0.78, baseSat: 1.55, baseLight: 1.12,
    rules: [
      { input: "leftHand", output: "palette", amount: -0.95, curve: "contrast", invert: false },
      { input: "rightHand", output: "palette", amount: 0.95, curve: "contrast", invert: false },
      { input: "velocity", output: "alpha", amount: 0.9, curve: "punch", invert: false },
      { input: "spread", output: "light", amount: 0.4, curve: "soft", invert: false }
    ],
    pattern: { type: "wave", output: "hue", amount: 0.08, periodMs: 3600 }
  }
};

BUILTIN.cathedral = {
  name: "Cathedral",
  config: {
    palette: ["#080013", "#1b0652", "#5a2bd8", "#f6d891", "#fff7d7", "#ffffff"],
    minNote: 24, maxNote: 100, minAlpha: 55, maxAlpha: 255, sendEveryMs: 360, dynamicRanges: true,
    smoothing: 0.12, smoothColor: true, basePos: 0.18, baseAlpha: 0.55, baseSat: 1.05, baseLight: 1.18,
    harmonyMode: "hybrid", arpeggioWindowMs: 950,
    rules: [
      { input: "harmonyMajor", output: "palette", amount: 0.75, curve: "soft", invert: false },
      { input: "harmonyMinor", output: "hue", amount: -0.22, curve: "soft", invert: false },
      { input: "sustain", output: "alpha", amount: 0.85, curve: "soft", invert: false },
      { input: "velocity", output: "light", amount: 0.35, curve: "punch", invert: false }
    ],
    pattern: { type: "breath", output: "alpha", amount: 0.18, periodMs: 3200 }
  }
};
BUILTIN.nocturne = {
  name: "Nocturne",
  config: {
    palette: ["#010414", "#071442", "#123d77", "#9eb7ff", "#e8efff"],
    minNote: 21, maxNote: 108, minAlpha: 20, maxAlpha: 215, sendEveryMs: 420, dynamicRanges: true,
    smoothing: 0.08, smoothColor: true, basePos: 0.12, baseAlpha: 0.35, baseSat: 1.15, baseLight: 0.92,
    harmonyMode: "memory", arpeggioWindowMs: 850,
    rules: [
      { input: "highest", output: "palette", amount: 0.85, curve: "soft", invert: false },
      { input: "leftHand", output: "hue", amount: -0.18, curve: "soft", invert: false },
      { input: "rightHand", output: "light", amount: 0.32, curve: "soft", invert: false },
      { input: "velocity", output: "alpha", amount: 0.75, curve: "soft", invert: false }
    ],
    pattern: { type: "wave", output: "hue", amount: 0.07, periodMs: 7000 }
  }
};
BUILTIN.arpeggioBloom = {
  name: "Arpeggio Bloom",
  config: {
    palette: ["#35004e", "#8b00ff", "#0077ff", "#00ffd5", "#fff000", "#ff7a00"],
    minNote: 21, maxNote: 108, minAlpha: 70, maxAlpha: 255, sendEveryMs: 260,
    smoothing: 0.14, smoothColor: true, basePos: 0.10, baseAlpha: 0.65, baseSat: 1.45, baseLight: 1.16,
    harmonyMode: "memory", arpeggioWindowMs: 700,
    rules: [
      { input: "arpeggioDirection", output: "palette", amount: 1.05, curve: "linear", invert: false },
      { input: "arpeggioSpeed", output: "alpha", amount: 0.90, curve: "contrast", invert: false },
      { input: "highest", output: "light", amount: 0.35, curve: "soft", invert: false },
      { input: "velocity", output: "saturation", amount: 0.35, curve: "punch", invert: false }
    ],
    pattern: { type: "wave", output: "palette", amount: 0.18, periodMs: 2600 }
  }
};
BUILTIN.jazzClub = {
  name: "Jazz Club",
  config: {
    palette: ["#110009", "#3a1028", "#6b2947", "#b86237", "#d7a64a", "#6841b8"],
    minNote: 24, maxNote: 96, minAlpha: 85, maxAlpha: 245, sendEveryMs: 330,
    smoothing: 0.16, smoothColor: true, basePos: 0.22, baseAlpha: 0.62, baseSat: 1.35, baseLight: 0.98,
    harmonyMode: "hybrid", arpeggioWindowMs: 600,
    rules: [
      { input: "blackKeys", output: "palette", amount: 0.65, curve: "contrast", invert: false },
      { input: "tension", output: "hue", amount: 0.24, curve: "soft", invert: false },
      { input: "harmonyDominant", output: "light", amount: 0.38, curve: "contrast", invert: false },
      { input: "velocity", output: "alpha", amount: 0.75, curve: "punch", invert: false }
    ],
    pattern: { type: "breath", output: "light", amount: 0.12, periodMs: 2100 }
  }
};
BUILTIN.glass = {
  name: "Glass",
  config: {
    palette: ["#011a2e", "#006caa", "#00d5ff", "#c6fbff", "#ffffff"],
    minNote: 21, maxNote: 108, minAlpha: 10, maxAlpha: 235, sendEveryMs: 300,
    smoothing: 0.10, smoothColor: true, basePos: 0.10, baseAlpha: 0.25, baseSat: 0.85, baseLight: 1.35,
    harmonyMode: "sustainAware", arpeggioWindowMs: 800,
    rules: [
      { input: "pitch", output: "palette", amount: 1.0, curve: "soft", invert: false },
      { input: "velocity", output: "alpha", amount: 1.0, curve: "contrast", invert: false },
      { input: "sustain", output: "light", amount: 0.42, curve: "soft", invert: false }
    ],
    pattern: { type: "breath", output: "alpha", amount: 0.16, periodMs: 4200 }
  }
};

BUILTIN.solarFlare = {
  name: "Solar Flare",
  config: {
    palette: PALETTE_LIBRARY.solar, minNote: 21, maxNote: 104, minAlpha: 95, maxAlpha: 255, sendEveryMs: 300, dynamicRanges: true,
    smoothing: 0.10, smoothColor: true, basePos: 0.10, baseAlpha: 0.55, baseSat: 1.75, baseLight: 1.25, harmonyMode: "hybrid", arpeggioWindowMs: 650,
    rules: [
      { input: "velocity", output: "palette", amount: 1.35, curve: "contrast", invert: false },
      { input: "density", output: "alpha", amount: 1.15, curve: "punch", invert: false },
      { input: "chordSize", output: "light", amount: 0.55, curve: "soft", invert: false }
    ],
    pattern: { type: "pulse", output: "light", amount: 0.22, periodMs: 820 }
  }
};
BUILTIN.starlight = {
  name: "Starlight",
  config: {
    palette: PALETTE_LIBRARY.starlight, minNote: 36, maxNote: 108, minAlpha: 10, maxAlpha: 245, sendEveryMs: 360, dynamicRanges: true,
    smoothing: 0.08, smoothColor: true, basePos: 0.05, baseAlpha: 0.18, baseSat: 1.35, baseLight: 1.45, harmonyMode: "memory", arpeggioWindowMs: 900,
    rules: [
      { input: "highest", output: "palette", amount: 1.0, curve: "soft", invert: false },
      { input: "velocity", output: "alpha", amount: 1.25, curve: "contrast", invert: false },
      { input: "arpeggioSpeed", output: "light", amount: 0.42, curve: "punch", invert: false }
    ],
    pattern: { type: "breath", output: "alpha", amount: 0.20, periodMs: 2600 }
  }
};
BUILTIN.ebonyIvoryPulse = {
  name: "Ebony Pulse",
  config: {
    palette: ["#fff8e8", "#15151c", "#ffffff", "#000000", "#ffcc55"], minNote: 21, maxNote: 108, minAlpha: 70, maxAlpha: 255, sendEveryMs: 300, dynamicRanges: true,
    smoothing: 0.16, smoothColor: true, basePos: 0.45, baseAlpha: 0.62, baseSat: 1.10, baseLight: 1.10, harmonyMode: "hybrid", arpeggioWindowMs: 700,
    rules: [
      { input: "blackKeys", output: "palette", amount: 1.30, curve: "contrast", invert: false },
      { input: "whiteKeys", output: "light", amount: 0.55, curve: "soft", invert: false },
      { input: "velocity", output: "alpha", amount: 1.0, curve: "contrast", invert: false }
    ],
    pattern: { type: "pulse", output: "alpha", amount: 0.12, periodMs: 1200 }
  }
};
BUILTIN.leftRightStage = {
  name: "Left / Right Stage",
  config: {
    palette: PALETTE_LIBRARY.leftRight, minNote: 21, maxNote: 108, minAlpha: 90, maxAlpha: 255, sendEveryMs: 280, dynamicRanges: true,
    smoothing: 0.12, smoothColor: true, basePos: 0.50, baseAlpha: 0.72, baseSat: 1.55, baseLight: 1.16, harmonyMode: "hybrid", arpeggioWindowMs: 600,
    rules: [
      { input: "leftHand", output: "palette", amount: -1.15, curve: "contrast", invert: false },
      { input: "rightHand", output: "palette", amount: 1.15, curve: "contrast", invert: false },
      { input: "spread", output: "light", amount: 0.55, curve: "soft", invert: false },
      { input: "velocity", output: "alpha", amount: 0.95, curve: "punch", invert: false }
    ],
    pattern: { type: "wave", output: "hue", amount: 0.10, periodMs: 4200 }
  }
};
BUILTIN.brassMachine = {
  name: "Brass Machine",
  config: {
    palette: PALETTE_LIBRARY.brass, minNote: 28, maxNote: 96, minAlpha: 80, maxAlpha: 255, sendEveryMs: 320, dynamicRanges: true,
    smoothing: 0.18, smoothColor: true, basePos: 0.18, baseAlpha: 0.65, baseSat: 1.35, baseLight: 1.10, harmonyMode: "memory", arpeggioWindowMs: 750,
    rules: [
      { input: "lowest", output: "palette", amount: 0.85, curve: "linear", invert: false },
      { input: "harmonyDominant", output: "light", amount: 0.45, curve: "hard", invert: false },
      { input: "density", output: "alpha", amount: 0.95, curve: "contrast", invert: false }
    ],
    pattern: { type: "saw", output: "palette", amount: 0.16, periodMs: 1800 }
  }
};


BUILTIN.cinemaPulse = {
  name: "Cinema Pulse",
  config: {
    palette: PALETTE_LIBRARY.cinema,
    minNote: 21, maxNote: 108, minAlpha: 80, maxAlpha: 255, sendEveryMs: 320, dynamicRanges: true,
    smoothing: 0.12, smoothColor: true, basePos: 0.18, baseAlpha: 0.62, baseSat: 1.35, baseLight: 1.05,
    harmonyMode: "hybrid", arpeggioWindowMs: 750,
    rules: [
      { input: "velocity", output: "alpha", amount: 0.85, curve: "contrast", invert: false },
      { input: "density", output: "light", amount: 0.45, curve: "soft", invert: false },
      { input: "lowest", output: "palette", amount: 0.55, curve: "linear", invert: false }
    ],
    patterns: [
      { type: "breath", output: "alpha", amount: 0.22, periodMs: 2600 },
      { type: "pulse", output: "light", amount: 0.28, periodMs: 920 }
    ],
    pattern: { type: "breath", output: "alpha", amount: 0.22, periodMs: 2600 }
  }
};

BUILTIN.neonScanner = {
  name: "Neon Scanner",
  config: {
    palette: PALETTE_LIBRARY.neonScanner,
    minNote: 21, maxNote: 108, minAlpha: 110, maxAlpha: 255, sendEveryMs: 300, dynamicRanges: true,
    smoothing: 0.06, smoothColor: true, basePos: 0.2, baseAlpha: 0.80, baseSat: 1.65, baseLight: 1.18,
    harmonyMode: "memory", arpeggioWindowMs: 550,
    rules: [
      { input: "pitchClass", output: "hardPalette", amount: 1.0, curve: "linear", invert: false },
      { input: "velocity", output: "alpha", amount: 0.8, curve: "contrast", invert: false },
      { input: "tension", output: "hue", amount: 0.22, curve: "punch", invert: false }
    ],
    patterns: [
      { type: "wave", output: "palette", amount: 0.42, periodMs: 1800 },
      { type: "strobe", output: "light", amount: 0.18, periodMs: 640 }
    ],
    pattern: { type: "wave", output: "palette", amount: 0.42, periodMs: 1800 }
  }
};

BUILTIN.goldenMetronome = {
  name: "Golden Metronome",
  config: {
    palette: PALETTE_LIBRARY.monochromeGold,
    minNote: 21, maxNote: 108, minAlpha: 50, maxAlpha: 255, sendEveryMs: 360, dynamicRanges: true,
    smoothing: 0.16, smoothColor: true, basePos: 0.35, baseAlpha: 0.50, baseSat: 1.25, baseLight: 1.08,
    harmonyMode: "hybrid", arpeggioWindowMs: 900,
    rules: [
      { input: "velocity", output: "alpha", amount: 0.65, curve: "contrast", invert: false },
      { input: "sustain", output: "light", amount: 0.35, curve: "soft", invert: false },
      { input: "chordSize", output: "palette", amount: 0.28, curve: "soft", invert: false }
    ],
    patterns: [
      { type: "blink", output: "alpha", amount: 0.26, periodMs: 1200 },
      { type: "saw", output: "hue", amount: 0.08, periodMs: 4800 }
    ],
    pattern: { type: "blink", output: "alpha", amount: 0.26, periodMs: 1200 }
  }
};

BUILTIN.leftRightDuel = {
  name: "Left / Right Duel",
  config: {
    palette: PALETTE_LIBRARY.leftRightElegance,
    minNote: 21, maxNote: 108, minAlpha: 105, maxAlpha: 255, sendEveryMs: 280, dynamicRanges: true,
    smoothing: 0.08, smoothColor: true, basePos: 0.5, baseAlpha: 0.78, baseSat: 1.55, baseLight: 1.12,
    harmonyMode: "hybrid", arpeggioWindowMs: 620,
    rules: [
      { input: "keyboardSide", output: "palette", amount: 1.1, curve: "contrast", invert: false },
      { input: "velocity", output: "alpha", amount: 0.9, curve: "contrast", invert: false },
      { input: "spread", output: "saturation", amount: 0.35, curve: "soft", invert: false }
    ],
    patterns: [
      { type: "wave", output: "hue", amount: 0.10, periodMs: 3600 }
    ],
    pattern: { type: "wave", output: "hue", amount: 0.10, periodMs: 3600 }
  }
};

const BLANK_CONFIG = {
  palette: ["#ff003c", "#ff9f00", "#ffee00"],
  minNote: 21,
  maxNote: 108,
  minAlpha: 60,
  maxAlpha: 255,
  sendEveryMs: 420,
  dynamicRanges: true,
  smoothing: 0.30,
  smoothColor: true,
  basePos: 0,
  baseAlpha: 0.75,
  baseSat: 1,
  baseLight: 1,
  rules: [
    { input: "pitch", output: "palette", amount: 1.0, curve: "linear", invert: false },
    { input: "velocity", output: "alpha", amount: 0.8, curve: "linear", invert: false }
  ],
  pattern: { type: "off", output: "alpha", amount: 0, periodMs: 2000 }
};

const C = { enabled: false, preset: "builtin:royal", customName: "", showMonitor: false, harmonyMode: "hybrid", arpeggioWindowMs: 700, ...structuredClone(BUILTIN.royal.config) };
const S = {
  hooked: false, originalSend: null, notes: [], active: new Map(), sustain: 0,
  lastNote: 60, lastVelocity: 0.7, intensity: 0, density: 0, lastSend: 0, sending: false,
  lastColor: "#7c4dffcc", smoothRgb: null, smoothAlpha: null,
  lastChord: [], lastFeatures: null, lastAnalysis: null, lastDecision: null,
  panel: null, status: null, preview: null, inspector: null, customPresets: {}, ranges: {}
};

const now = () => performance.now();
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const lerp = (a, b, t) => a + (b - a) * t;
const toHex = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
const norm = v => clamp(Number(v) || 0, 0, 1);

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const WHITE_PCS = new Set([0,2,4,5,7,9,11]);
const CHORD_QUALITIES = [
  { name: "maj13", intervals: [0,4,7,11,2,9] },
  { name: "m13", intervals: [0,3,7,10,2,9] },
  { name: "maj9", intervals: [0,4,7,11,2] },
  { name: "m9", intervals: [0,3,7,10,2] },
  { name: "9", intervals: [0,4,7,10,2] },
  { name: "7", intervals: [0,4,7,10] },
  { name: "maj7", intervals: [0,4,7,11] },
  { name: "m7", intervals: [0,3,7,10] },
  { name: "mMaj7", intervals: [0,3,7,11] },
  { name: "dim7", intervals: [0,3,6,9] },
  { name: "ø7", intervals: [0,3,6,10] },
  { name: "aug", intervals: [0,4,8] },
  { name: "dim", intervals: [0,3,6] },
  { name: "sus4", intervals: [0,5,7] },
  { name: "sus2", intervals: [0,2,7] },
  { name: "m", intervals: [0,3,7] },
  { name: "", intervals: [0,4,7] },
  { name: "5", intervals: [0,7] }
];
function noteName(note){ const n=Math.round(Number(note)||0); return `${NOTE_NAMES[((n%12)+12)%12]}${Math.floor(n/12)-1}`; }
function pcName(pc){ return NOTE_NAMES[((Math.round(pc)%12)+12)%12]; }
function isBlackKey(note){ return !WHITE_PCS.has(((Math.round(note)%12)+12)%12); }
function detectChord(chord){
  const notes=[...new Set(chord.map(x=>Math.round(Number(x.note))).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(!notes.length) return { name:"—", notes:[], pcs:[], root:null, quality:"", confidence:0 };
  const pcs=[...new Set(notes.map(n=>((n%12)+12)%12))].sort((a,b)=>a-b);
  if(pcs.length===1) return { name: noteName(notes[0]), notes, pcs, root: pcs[0], quality:"single", confidence:1 };
  let best=null;
  for(const root of pcs){
    const rel=pcs.map(pc=>(pc-root+12)%12);
    for(const q of CHORD_QUALITIES){
      const hits=q.intervals.filter(iv=>rel.includes(iv)).length;
      const misses=Math.max(0,q.intervals.length-hits);
      const extras=rel.filter(iv=>!q.intervals.includes(iv)).length;
      const hasRoot=rel.includes(0)?0.25:0;
      const score=hits/q.intervals.length - extras*0.16 - misses*0.08 + hasRoot;
      if(!best || score>best.score) best={root, quality:q.name, score, hits, extras};
    }
  }
  if(!best || best.score<0.45) return { name: pcs.map(pcName).join(" "), notes, pcs, root:null, quality:"cluster", confidence:clamp(best?.score||0,0,1) };
  return { name: pcName(best.root) + best.quality, notes, pcs, root:best.root, quality:best.quality||"major", confidence:clamp(best.score,0,1) };
}
function formatPercent(x){ return `${Math.round(clamp(Number(x)||0,0,1)*100)}%`; }

function setReactiveGlobalFlag(){ try { window.__MO_REACTIVE_COLOR_ENABLED__ = !!C.enabled; } catch {} }
function loadCustomPresets(){ try { S.customPresets = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { S.customPresets = {}; } }
function saveCustomPresets(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(S.customPresets)); } catch {} }
function cloneConfig(config){ return structuredClone(config); }
function normalizePalette(pal){ return (Array.isArray(pal) ? pal : String(pal || "").split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean); }
function hexToRgb(hex){
  hex = String(hex || "").trim(); if (!hex.startsWith("#")) hex = "#" + hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = "#" + hex.slice(1).split("").map(c => c + c).join("");
  const m = hex.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i); if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b, a = 255){ return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`; }
function colorAtPalette(palette, pos){
  const pal = normalizePalette(palette); if (!pal.length) return [255,255,255]; if (pal.length === 1) return hexToRgb(pal[0]);
  const f = clamp(pos, 0, 1) * (pal.length - 1); const i = Math.floor(f); const t = f - i;
  const a = hexToRgb(pal[i]); const b = hexToRgb(pal[Math.min(i + 1, pal.length - 1)]);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function boostRgb(rgb, satBoost, lightBoost){
  let [r,g,b] = rgb.map(x => clamp(x,0,255)); const grey=(r+g+b)/3;
  r = grey + (r-grey)*satBoost; g = grey + (g-grey)*satBoost; b = grey + (b-grey)*satBoost;
  r *= lightBoost; g *= lightBoost; b *= lightBoost;
  return [clamp(r,0,255), clamp(g,0,255), clamp(b,0,255)];
}
function applyCurve(x, curve){
  x = clamp(x, 0, 1);
  if (curve === "soft") return Math.sqrt(x);
  if (curve === "punch") return x * x * (3 - 2 * x);
  if (curve === "contrast") return clamp((x - 0.18) / 0.72, 0, 1);
  if (curve === "hard") return x < 0.42 ? 0 : 1;
  if (curve === "exp") return x * x;
  return x;
}
function dynamicFeature(name, value){
  value = clamp(Number(value)||0, 0, 1);
  if(!C.dynamicRanges) return value;
  if(!["velocity","density","intensity","tension","spread","arpeggioSpeed","repetition","chordSize"].includes(name)) return value;
  const r = S.ranges[name] || (S.ranges[name] = { min:value, max:value, t:now() });
  const relax = 0.0025;
  r.min = Math.min(value, lerp(r.min, value, relax));
  r.max = Math.max(value, lerp(r.max, value, relax));
  const span = r.max - r.min;
  if(span < 0.08) return clamp(value * 1.25, 0, 1);
  return clamp((value - r.min) / span, 0, 1);
}
function applyDynamicFeatures(f){
  const out = { ...f };
  for(const k of ["velocity","density","intensity","tension","spread","arpeggioSpeed","repetition","chordSize"]){
    out[k] = dynamicFeature(k, out[k]);
  }
  return out;
}
function resetDynamicRanges(){ S.ranges = {}; }
function hashText(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function chordSignature(chord){ return [...new Set(chord.map(n => ((Math.round(n.note) % 12) + 12) % 12))].sort((a,b)=>a-b).join("-"); }
function tension(chord){
  const pcs=[...new Set(chord.map(n => ((Math.round(n.note)%12)+12)%12))]; let t=0;
  for(let i=0;i<pcs.length;i++) for(let j=i+1;j<pcs.length;j++){ const d=Math.abs(pcs[i]-pcs[j]); const iv=Math.min(d,12-d); if([1,2,6].includes(iv)) t+=.22; if([3,4,8,9].includes(iv)) t+=.08; if([5,7].includes(iv)) t+=.03; }
  return clamp(t,0,1);
}
function computeIntensity(){
  const t=now(); S.notes=S.notes.filter(e => t-e.t < 1600);
  const recent=S.notes.filter(e => t-e.t < 1000); const rate=clamp(recent.length/28,0,1); const av=recent.length?avg(recent.map(e=>e.velocity)):0; const size=clamp(S.active.size/10,0,1);
  S.density=rate; S.intensity=clamp(0.18 + av*.34 + rate*.25 + size*.23 + S.sustain*.12, 0, 1);
}
function memoryChord(){
  const t=now(); const win=Math.max(40, Number(C.arpeggioWindowMs)||700);
  const byNote=new Map();
  for(const e of S.notes){ if(t-e.t <= win) byNote.set(Math.round(e.note), {note:e.note, velocity:e.velocity, t:e.t}); }
  return [...byNote.values()].sort((a,b)=>a.t-b.t).map(x=>({note:x.note, velocity:x.velocity, t:x.t}));
}
function getChord(fallback){
  const active=[...S.active.values()].map(x=>({note:x.note,velocity:x.velocity,t:x.t}));
  const mem=memoryChord();
  const mode=C.harmonyMode || "hybrid";
  if(mode==="active") return active.length ? active : (fallback?.length ? fallback : [{note:S.lastNote,velocity:S.lastVelocity,t:now()}]);
  if(mode==="memory") return mem.length ? mem : (active.length ? active : (fallback?.length ? fallback : [{note:S.lastNote,velocity:S.lastVelocity,t:now()}]));
  if(mode==="sustainAware"){
    if(S.sustain > 0.15 && mem.length) return mem;
    return active.length ? active : (fallback?.length ? fallback : [{note:S.lastNote,velocity:S.lastVelocity,t:now()}]);
  }
  const combined=new Map();
  for(const x of [...mem,...active]) combined.set(Math.round(x.note), x);
  const out=[...combined.values()].sort((a,b)=>(a.t||0)-(b.t||0));
  return out.length ? out : (fallback?.length ? fallback : [{note:S.lastNote,velocity:S.lastVelocity,t:now()}]);
}
function getFeatures(chord){
  computeIntensity();
  const notes=chord.map(x=>Number(x.note)).filter(Number.isFinite); const vels=chord.map(x=>Number(x.velocity ?? .7));
  const times=chord.map(x=>Number(x.t ?? now())).filter(Number.isFinite);
  const minN=Math.min(...notes), maxN=Math.max(...notes), avgN=avg(notes), avVel=avg(vels), sig=chordSignature(chord), hash=hashText(sig+":"+Math.round(avgN));
  const nrm = n => clamp((n - C.minNote) / Math.max(1, C.maxNote - C.minNote), 0, 1);
  const blacks = notes.filter(isBlackKey).length;
  const whites = notes.length - blacks;
  const leftNotes = notes.filter(n => n < 60).length;
  const rightNotes = notes.filter(n => n >= 60).length;
  const octaveAvg = clamp(((avgN / 12) - 1) / 8, 0, 1);
  const ordered=chord.slice().filter(x=>Number.isFinite(Number(x.note))).sort((a,b)=>(a.t||0)-(b.t||0));
  const first=ordered[0]?.note ?? avgN, last=ordered[ordered.length-1]?.note ?? avgN;
  const dir=ordered.length>1 ? clamp((last-first+24)/48,0,1) : 0.5;
  const spanT=times.length>1 ? Math.max(...times)-Math.min(...times) : 0;
  const arpSpeed=ordered.length>1 ? clamp(1 - spanT/Math.max(50, Number(C.arpeggioWindowMs)||700),0,1) : 0;
  let repeats=0; const pcCounts={}; for(const n of notes){const pc=((Math.round(n)%12)+12)%12; pcCounts[pc]=(pcCounts[pc]||0)+1; if(pcCounts[pc]>1) repeats++;}
  const chordInfo=detectChord(chord);
  const q=String(chordInfo.quality||"");
  const harmonyMajor=(q==="major"||q.includes("maj")||q==="") && chordInfo.root!=null ? 1 : 0;
  const harmonyMinor=q.includes("m") && !q.includes("maj") ? 1 : 0;
  const harmonyDominant=q==="7"||q==="9"||q.includes("13") ? 1 : 0;
  const harmonySus=q.includes("sus") ? 1 : 0;
  const harmonyCluster=q==="cluster" || chordInfo.confidence<0.45 ? 1 : 0;
  const base = {
    pitch: nrm(avgN), lowest: nrm(minN), highest: nrm(maxN), pitchClass: (((Math.round(avgN)%12)+12)%12)/11,
    velocity: clamp(avVel,0,1), density: S.density, chordSize: clamp(chord.length/8,0,1), intensity: S.intensity,
    tension: tension(chord), spread: clamp((maxN-minN)/36,0,1), sustain: clamp(S.sustain,0,1),
    chordHash: (hash % 1000)/999, time: (Math.sin(now()/1000*Math.PI*2)+1)/2,
    blackKeys: notes.length ? blacks / notes.length : 0,
    whiteKeys: notes.length ? whites / notes.length : 0,
    leftHand: notes.length ? leftNotes / notes.length : 0,
    rightHand: notes.length ? rightNotes / notes.length : 0,
    octave: octaveAvg,
    noteIdentity: (((Math.round(avgN)%12)+12)%12)/11,
    currentKey: isBlackKey(S.lastNote) ? 1 : 0,
    dominantKey: blacks >= whites ? 1 : 0,
    keyboardSide: clamp((avgN - 48) / 36, 0, 1),
    arpeggioDirection: dir,
    arpeggioSpeed: arpSpeed,
    repetition: notes.length ? clamp(repeats/notes.length,0,1) : 0,
    harmonyMajor, harmonyMinor, harmonyDominant, harmonySus, harmonyCluster,
    chordConfidence: clamp(chordInfo.confidence||0,0,1)
  };
  return applyDynamicFeatures(base);
}
function activePatterns(){
  if (Array.isArray(C.patterns) && C.patterns.length) return C.patterns;
  if (C.pattern && C.pattern.type && C.pattern.type !== "off") return [C.pattern];
  return [];
}
function patternValue(type, periodMs){
  if (!type || type === "off") return 0.5;
  const phase = ((now() % Math.max(50, Number(periodMs)||1000)) / Math.max(50, Number(periodMs)||1000));
  if (type === "pulse") return (Math.sin(phase * Math.PI * 2) + 1) / 2;
  if (type === "breath") return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  if (type === "blink") return phase < 0.5 ? 0 : 1;
  if (type === "strobe") return phase < 0.14 ? 1 : 0;
  if (type === "wave") return phase;
  if (type === "saw") return phase;
  return 0.5;
}
function applyOutput(out, value, amount, acc){
  amount = Number(amount); if (!Number.isFinite(amount)) amount = 1;
  if (out === "hardPalette") acc.hardPos = amount >= 0 ? value : 1 - value;
  else if (out === "palette") acc.pos += (value - 0.5) * amount;
  else if (out === "alpha") acc.alpha += (value - 0.5) * amount;
  else if (out === "saturation") acc.sat += (value - 0.5) * amount;
  else if (out === "light") acc.light += (value - 0.5) * amount;
  else if (out === "hue") acc.hue += (value - 0.5) * amount;
}
function makeColor(chord){
  const features=getFeatures(chord);
  const chordInfo=detectChord(chord);
  const acc = { pos: Number(C.basePos)||0, alpha: Number(C.baseAlpha)||0.75, sat: Number(C.baseSat)||1, light: Number(C.baseLight)||1, hue: 0, hardPos: null };
  const ruleTrace=[];
  for (const r of (C.rules || [])) {
    let raw = features[r.input] ?? 0;
    let v = applyCurve(raw, r.curve);
    if (r.invert) v = 1-v;
    applyOutput(r.output, v, r.amount, acc);
    ruleTrace.push({ input:r.input, output:r.output, raw, value:v, amount:Number(r.amount)||0, curve:r.curve||"linear", invert:!!r.invert });
  }
  let patternTrace=[];
  for (const pat of activePatterns()) {
    if (!pat?.type || pat.type === "off") continue;
    let v = patternValue(pat.type, pat.periodMs);
    applyOutput(pat.output, v, pat.amount, acc);
    patternTrace.push({ type:pat.type, output:pat.output, value:v, amount:Number(pat.amount)||0, periodMs:Number(pat.periodMs)||0 });
  }
  let pos = acc.hardPos != null ? clamp(acc.hardPos, 0, 1) : ((acc.pos % 1) + 1) % 1;
  let rgb = colorAtPalette(C.palette, pos);
  if (acc.hue) rgb = colorAtPalette([rgbToHex(...rgb), ...normalizePalette(C.palette)], ((pos + acc.hue) % 1 + 1) % 1);
  rgb = boostRgb(rgb, clamp(acc.sat,0.05,3), clamp(acc.light,0.05,3));
  let alpha = lerp(C.minAlpha, C.maxAlpha, clamp(acc.alpha, 0, 1));
  if (C.smoothColor) {
    if(!S.smoothRgb) S.smoothRgb=rgb; if(S.smoothAlpha==null) S.smoothAlpha=alpha;
    const sm=clamp(C.smoothing,0.01,1); S.smoothRgb=[lerp(S.smoothRgb[0],rgb[0],sm),lerp(S.smoothRgb[1],rgb[1],sm),lerp(S.smoothRgb[2],rgb[2],sm)]; S.smoothAlpha=lerp(S.smoothAlpha,alpha,sm);
    rgb=S.smoothRgb; alpha=S.smoothAlpha;
  }
  const color = rgbToHex(rgb[0],rgb[1],rgb[2],alpha);
  S.lastChord=chord.map(n=>({note:Number(n.note),velocity:Number(n.velocity??0)}));
  S.lastFeatures=features;
  S.lastAnalysis={ chord:chordInfo, notes:chordInfo.notes.map(noteName), activeCount:S.active.size, harmonyMode:C.harmonyMode||"hybrid", arpeggioWindowMs:Number(C.arpeggioWindowMs)||700 };
  S.lastDecision={ color, palettePos:pos, hardPalette:acc.hardPos != null, alpha:clamp(alpha/255,0,1), alphaByte:Math.round(clamp(alpha,0,255)), saturation:acc.sat, light:acc.light, hueOffset:acc.hue, rules:ruleTrace, pattern:patternTrace };
  return color;
}
async function sendPreference(color){
  if(S.sending) return; S.sending=true;
  try{ const res=await fetch(PREF_ENDPOINT,{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({colors:[color]})}); if(!res.ok) throw new Error("HTTP "+res.status); S.lastColor=color; updateUI(); }
  catch(e){ updateUI("error " + e.message); console.warn("[MO Reactive Color]",e); }
  finally{ S.sending=false; }
}
function maybeSend(chord){ if(!C.enabled) return; const t=now(); if(t-S.lastSend<C.sendEveryMs) return; S.lastSend=t; sendPreference(makeColor(getChord(chord))); }
function recordNote(note, velocity=.7, source="ws"){
  note=Number(note); velocity=Number(velocity); if(!Number.isFinite(note)) return; if(!Number.isFinite(velocity)) velocity=.7; if(velocity>1) velocity/=127;
  note=clamp(note,0,127); velocity=clamp(velocity,.02,1); const t=now(); S.lastNote=note; S.lastVelocity=velocity; S.active.set(note,{note,velocity,t}); S.notes.push({t,note,velocity,source}); computeIntensity(); maybeSend([{note,velocity}]);
}
function recordOff(note){ S.active.delete(Number(note)); }
function normalizeEvent(e){
  if(!e) return null;
  if(Array.isArray(e)){ const st=Number(e[0]), note=Number(e[1]), vel=Number(e[2]??0); if(!Number.isFinite(st)||!Number.isFinite(note)) return null; if((st&0xf0)===0x90&&vel>0) return {type:"on",note,velocity:vel/127}; if((st&0xf0)===0x80||((st&0xf0)===0x90&&vel===0)) return {type:"off",note}; if((st&0xf0)===0xb0 && note===64) return {type:"sustain", value: vel/127}; return null; }
  if(typeof e!=="object") return null;
  const name=String(e.name??e.type??e.event??e.evt??e.kind??"").toUpperCase(); const note=e.note??e.n??e.k??e.key??e.midi??e.pitch??e.noteNumber; const velocity=e.velocity??e.vel??e.v??e.value??e.force??127;
  if(name.includes("SUSTAIN") || e.cc===64 || e.control===64) return {type:"sustain", value:Number(velocity)>1?Number(velocity)/127:Number(velocity)};
  const on=name==="NOTE_ON"||name==="ON"||name.includes("NOTEON")||name.includes("PRESS")||e.on===true||e.down===true;
  const off=name==="NOTE_OFF"||name==="OFF"||name.includes("NOTEOFF")||name.includes("RELEASE")||e.off===true||e.up===true;
  if(on&&note!=null) return {type:"on",note:Number(note),velocity:Number(velocity)}; if(off&&note!=null) return {type:"off",note:Number(note)}; return null;
}
function scanObj(x, found=[], depth=0){ if(!x||depth>8) return found; const ev=normalizeEvent(x); if(ev){found.push(ev); return found;} if(Array.isArray(x)){for(const it of x) scanObj(it,found,depth+1); return found;} if(typeof x==="object") for(const k of Object.keys(x)){const v=x[k]; if(v&&typeof v==="object") scanObj(v,found,depth+1);} return found; }
function extractFrames(str){ const out=[]; let i=0; while(i<str.length){ const start=str.indexOf("[",i); if(start<0) break; let d=0,end=-1,qs=false,esc=false; for(let j=start;j<str.length;j++){ const c=str[j]; if(qs){ if(esc) esc=false; else if(c==="\\") esc=true; else if(c==='"') qs=false; continue;} if(c==='"') qs=true; else if(c==="[") d++; else if(c==="]"){ d--; if(d===0){end=j+1;break;} } } if(end<0) break; try{out.push(JSON.parse(str.slice(start,end)));}catch{} i=end;} return out; }
function handleOutgoing(data){
  try{ let str=null; if(typeof data==="string") str=data; else if(data instanceof ArrayBuffer&&TD) str=TD.decode(new Uint8Array(data)); else if(ArrayBuffer.isView(data)&&TD) str=TD.decode(new Uint8Array(data.buffer)); if(!str) return;
    let found=[]; for(const fr of extractFrames(str)) scanObj(fr,found,0); if(!found.length){try{scanObj(JSON.parse(str),found,0);}catch{}}
    if(!found.length) return; const ons=[]; for(const ev of found){ if(ev.type==="on"){recordNote(ev.note,ev.velocity,"ws-out"); ons.push({note:ev.note,velocity:ev.velocity});} else if(ev.type==="off") recordOff(ev.note); else if(ev.type==="sustain") S.sustain=clamp(ev.value,0,1); } if(ons.length>1) maybeSend(ons);
  }catch{}
}
function hookSend(){ if(S.hooked) return; const RealWS=window.WebSocket; if(!RealWS?.prototype?.send) return; S.originalSend=RealWS.prototype.send; RealWS.prototype.send=function(data){ handleOutgoing(data); return S.originalSend.apply(this,arguments); }; S.hooked=true; }
function presetList(){ return { ...Object.fromEntries(Object.entries(BUILTIN).map(([k,v])=>["builtin:"+k,v])), ...Object.fromEntries(Object.entries(S.customPresets).map(([k,v])=>["custom:"+k,v])) }; }
function applyConfig(config, preset="custom"){ Object.assign(C, cloneConfig(config)); C.preset=preset; S.smoothRgb=null; S.smoothAlpha=null; resetDynamicRanges(); }
function palettePreviewHtml(palette){ return normalizePalette(palette).map(c=>`<span class="mo-rc-swatch" style="background:${c}" title="${c}"></span>`).join(""); }
function renderInspector(){
  if(!S.inspector) return;
  if(!C.showMonitor){ S.inspector.style.display="none"; return; }
  S.inspector.style.display="block";
  const f=S.lastFeatures;
  const d=S.lastDecision;
  const a=S.lastAnalysis;
  if(!f || !d || !a){
    S.inspector.innerHTML = `<div class="mo-meter-title">Signal Monitor</div><div class="mo-rc-small">Play notes to see the detected chord and modulation output.</div>`;
    return;
  }
  const strongest=(d.rules||[]).slice().sort((x,y)=>Math.abs(y.amount*(y.value-.5))-Math.abs(x.amount*(x.value-.5))).slice(0,4);
  const ruleHtml=strongest.length?strongest.map(r=>`<div class="trace-row"><span>${r.input}</span><b>${formatPercent(r.raw)}</b><span>→ ${r.output}</span></div>`).join(""):"<div class=\"mo-rc-small\">No active modulation rule</div>";
  S.inspector.innerHTML = `
    <div class="monitor-head"><span class="monitor-title">Signal Monitor</span><span class="monitor-color" style="background:${d.color}"></span><code>${d.color}</code></div>
    <div class="monitor-grid">
      <div><span>Chord</span><b>${a.chord.name}</b></div>
      <div><span>Notes</span><b>${a.notes.join(" ") || "—"}</b></div>
      <div><span>Velocity</span><b>${formatPercent(f.velocity)}</b></div>
      <div><span>Density</span><b>${formatPercent(f.density)}</b></div>
      <div><span>Tension</span><b>${formatPercent(f.tension)}</b></div>
      <div><span>Spread</span><b>${formatPercent(f.spread)}</b></div>
      <div><span>Black keys</span><b>${formatPercent(f.blackKeys)}</b></div>
      <div><span>Current key</span><b>${f.currentKey >= 0.5 ? "Black" : "White"}</b></div>
      <div><span>Left / Right</span><b>${formatPercent(f.leftHand)} / ${formatPercent(f.rightHand)}</b></div>
      <div><span>Arp direction</span><b>${formatPercent(f.arpeggioDirection)}</b></div>
      <div><span>Arp speed</span><b>${formatPercent(f.arpeggioSpeed)}</b></div>
      <div><span>Harmony mode</span><b>${a.harmonyMode} / ${a.arpeggioWindowMs}ms</b></div>
      <div><span>Confidence</span><b>${formatPercent(f.chordConfidence)}</b></div>
      <div><span>Palette pos</span><b>${formatPercent(d.palettePos)}</b></div>
      <div><span>Alpha</span><b>${d.alphaByte}</b></div>
    </div>
    <div class="trace-title">Main modulation</div>${ruleHtml}
  `;
}
function updateUI(msg){ if(S.preview){ S.preview.style.background=S.lastColor; S.preview.style.boxShadow=`0 0 ${12+S.intensity*42}px ${S.lastColor}`; } if(S.status) S.status.textContent=msg || (C.enabled?"ON":"OFF"); renderInspector(); }

const INPUTS = ["pitch","lowest","highest","pitchClass","noteIdentity","octave","currentKey","dominantKey","keyboardSide","velocity","density","chordSize","intensity","tension","spread","sustain","chordHash","blackKeys","whiteKeys","leftHand","rightHand","arpeggioDirection","arpeggioSpeed","repetition","harmonyMajor","harmonyMinor","harmonyDominant","harmonySus","harmonyCluster","chordConfidence","time"];
const OUTPUTS = ["palette","hardPalette","alpha","saturation","light","hue"];
const INPUT_LABELS = { pitch:"Average pitch", lowest:"Lowest note", highest:"Highest note", pitchClass:"Pitch class", noteIdentity:"Note name", octave:"Octave", currentKey:"Current key black/white", dominantKey:"Dominant key black/white", keyboardSide:"Keyboard side left/right", velocity:"Velocity", density:"Note density", chordSize:"Chord size", intensity:"Overall intensity", tension:"Dissonance", spread:"Bass↔treble spread", sustain:"Sustain", chordHash:"Chord identity", blackKeys:"Black-key ratio", whiteKeys:"White-key ratio", leftHand:"Left-hand ratio", rightHand:"Right-hand ratio", arpeggioDirection:"Arpeggio direction", arpeggioSpeed:"Arpeggio speed", repetition:"Repeated notes", harmonyMajor:"Major color", harmonyMinor:"Minor color", harmonyDominant:"Dominant color", harmonySus:"Suspended color", harmonyCluster:"Cluster / unknown", chordConfidence:"Chord confidence", time:"Time / LFO" };
const OUTPUT_LABELS = { palette:"Palette position (blend)", hardPalette:"Palette slot (hard)", alpha:"Alpha", saturation:"Saturation", light:"Light", hue:"Hue shift" };
const CURVES = ["linear","soft","punch","contrast","hard","exp"];

function renderPresetButtons(box){
  const wrap=box.querySelector("#mo-rc-presets"); const all=presetList();
  wrap.innerHTML=Object.entries(all).map(([key,p])=>`<button class="mo-preset" data-preset="${key}">${p.name}</button>`).join("");
  wrap.querySelectorAll("[data-preset]").forEach(btn=>{ btn.onclick=()=>{ const key=btn.dataset.preset; const p=presetList()[key]; applyConfig(p.config,key); sync(box); updateUI(p.name); }; });
}
function ruleRow(rule, idx){
  const opt=(arr,val,labels={})=>arr.map(x=>`<option value="${x}" ${x===val?"selected":""}>${labels[x]||x}</option>`).join("");
  return `<div class="mo-rule" data-i="${idx}">
    <select class="r-input">${opt(INPUTS,rule.input,INPUT_LABELS)}</select>
    <span class="arrow">→</span>
    <select class="r-output">${opt(OUTPUTS,rule.output,OUTPUT_LABELS)}</select>
    <input class="r-amount" type="range" min="-2" max="2" step="0.05" value="${rule.amount}">
    <select class="r-curve">${opt(CURVES,rule.curve||"linear")}</select>
    <label><input class="r-invert" type="checkbox" ${rule.invert?"checked":""}> inv</label>
    <button class="mo-btn small r-del">×</button>
  </div>`;
}
function renderRules(box){
  const list=box.querySelector("#mo-rc-rules"); list.innerHTML=(C.rules||[]).map(ruleRow).join("");
  list.querySelectorAll(".mo-rule").forEach(row=>{
    const i=Number(row.dataset.i); const read=()=>{ const r=C.rules[i]; if(!r) return; r.input=row.querySelector(".r-input").value; r.output=row.querySelector(".r-output").value; r.amount=Number(row.querySelector(".r-amount").value); r.curve=row.querySelector(".r-curve").value; r.invert=row.querySelector(".r-invert").checked; C.preset="custom"; syncActiveOnly(box); };
    row.querySelectorAll("select,input").forEach(el=>el.onchange=read);
    row.querySelector(".r-del").onclick=()=>{ C.rules.splice(i,1); renderRules(box); syncActiveOnly(box); };
  });
}
function renderPaletteEditor(box){
  const wrap=box.querySelector("#mo-rc-palette-editor");
  wrap.innerHTML=normalizePalette(C.palette).map((c,i)=>`<div class="color-cell"><input type="color" value="${c.slice(0,7)}" data-i="${i}"><button class="mo-btn small" data-del="${i}">×</button></div>`).join("") + `<button id="mo-rc-add-color" class="mo-btn">+ Color</button>`;
  wrap.querySelectorAll("input[type=color]").forEach(inp=>inp.oninput=()=>{ C.palette[Number(inp.dataset.i)]=inp.value; C.preset="custom"; syncActiveOnly(box); });
  wrap.querySelectorAll("[data-del]").forEach(btn=>btn.onclick=()=>{ C.palette.splice(Number(btn.dataset.del),1); if(!C.palette.length) C.palette=["#ffffff"]; renderPaletteEditor(box); syncActiveOnly(box); });
  wrap.querySelector("#mo-rc-add-color").onclick=()=>{ C.palette.push("#ffffff"); renderPaletteEditor(box); syncActiveOnly(box); };
}

function patternRow(pat, idx){
  const opt=(arr,val,labels={})=>arr.map(x=>`<option value="${x}" ${x===val?"selected":""}>${labels[x]||x}</option>`).join("");
  const patterns=["off","pulse","breath","blink","strobe","wave","saw"];
  return `<div class="mo-pattern" data-i="${idx}">
    <select class="p-type">${opt(patterns, pat.type||"off")}</select>
    <span class="arrow">→</span>
    <select class="p-output">${opt(OUTPUTS, pat.output||"alpha", OUTPUT_LABELS)}</select>
    <input class="p-amount" type="range" min="-2" max="2" step="0.05" value="${pat.amount ?? 0}">
    <input class="p-period" type="number" min="50" max="20000" step="50" value="${pat.periodMs ?? 2000}">
    <button class="mo-btn small p-del">×</button>
  </div>`;
}
function renderPatterns(box){
  const list=box.querySelector("#mo-rc-patterns"); if(!list) return;
  const pats=Array.isArray(C.patterns) ? C.patterns : (C.pattern ? [C.pattern] : []);
  list.innerHTML=pats.map(patternRow).join("");
  list.querySelectorAll(".mo-pattern").forEach(row=>{
    const i=Number(row.dataset.i);
    const read=()=>{ if(!Array.isArray(C.patterns)) C.patterns=[]; C.patterns[i]={ type:row.querySelector(".p-type").value, output:row.querySelector(".p-output").value, amount:Number(row.querySelector(".p-amount").value), periodMs:Number(row.querySelector(".p-period").value) }; C.pattern=C.patterns[0] || { type:"off", output:"alpha", amount:0, periodMs:2000 }; C.preset="custom"; syncActiveOnly(box); };
    row.querySelectorAll("select,input").forEach(el=>el.onchange=read);
    row.querySelector(".p-del").onclick=()=>{ C.patterns.splice(i,1); C.pattern=C.patterns[0] || { type:"off", output:"alpha", amount:0, periodMs:2000 }; renderPatterns(box); syncActiveOnly(box); };
  });
}

function readExpertNumbers(box){
  C.minNote=Number(box.querySelector("#minNote").value); C.maxNote=Number(box.querySelector("#maxNote").value); C.minAlpha=Number(box.querySelector("#minAlpha").value); C.maxAlpha=Number(box.querySelector("#maxAlpha").value); C.sendEveryMs=Number(box.querySelector("#speed").value);
  C.harmonyMode=box.querySelector("#harmonyMode").value; C.arpeggioWindowMs=Number(box.querySelector("#arpeggioWindow").value);
  C.dynamicRanges=box.querySelector("#dynamicRanges").checked;
  C.basePos=Number(box.querySelector("#basePos").value); C.baseAlpha=Number(box.querySelector("#baseAlpha").value); C.baseSat=Number(box.querySelector("#baseSat").value); C.baseLight=Number(box.querySelector("#baseLight").value); C.smoothing=Number(box.querySelector("#smoothAmt").value); C.smoothColor=box.querySelector("#smoothColor").checked;
  C.patterns=[...box.querySelectorAll(".mo-pattern")].map(row=>({ type:row.querySelector(".p-type").value, output:row.querySelector(".p-output").value, amount:Number(row.querySelector(".p-amount").value), periodMs:Number(row.querySelector(".p-period").value) }));
  C.pattern=C.patterns[0] || { type:"off", output:"alpha", amount:0, periodMs:2000 };
  C.preset="custom"; S.smoothRgb=null; S.smoothAlpha=null; resetDynamicRanges();
}
function fillExpert(box){
  box.querySelector("#minNote").value=C.minNote; box.querySelector("#maxNote").value=C.maxNote; box.querySelector("#minAlpha").value=C.minAlpha; box.querySelector("#maxAlpha").value=C.maxAlpha; box.querySelector("#speed").value=C.sendEveryMs;
  box.querySelector("#harmonyMode").value=C.harmonyMode||"hybrid"; box.querySelector("#arpeggioWindow").value=C.arpeggioWindowMs||700;
  box.querySelector("#dynamicRanges").checked=!!C.dynamicRanges;
  box.querySelector("#basePos").value=C.basePos; box.querySelector("#baseAlpha").value=C.baseAlpha; box.querySelector("#baseSat").value=C.baseSat; box.querySelector("#baseLight").value=C.baseLight; box.querySelector("#smoothAmt").value=C.smoothing; box.querySelector("#smoothColor").checked=!!C.smoothColor;
  renderPatterns(box);
}
function syncActiveOnly(box){
  box.querySelectorAll("[data-preset]").forEach(b=>b.classList.toggle("active",b.dataset.preset===C.preset));
  box.querySelector("#mo-rc-palette").innerHTML=palettePreviewHtml(C.palette); updateUI();
}
function sync(box){
  box.querySelector("#mo-rc-toggle").textContent=C.enabled?"ON":"OFF"; box.querySelector("#mo-rc-toggle").classList.toggle("active",C.enabled); box.querySelector("#mo-rc-monitor-toggle").classList.toggle("active",!!C.showMonitor);
  box.querySelector("#mo-rc-current").textContent=(presetList()[C.preset]?.name)||"Custom"; syncActiveOnly(box); fillExpert(box); renderRules(box); renderPaletteEditor(box);
}
function serializeCurrent(name){ return { name, config: cloneConfig({ palette:C.palette,minNote:C.minNote,maxNote:C.maxNote,minAlpha:C.minAlpha,maxAlpha:C.maxAlpha,sendEveryMs:C.sendEveryMs,smoothing:C.smoothing,smoothColor:C.smoothColor,basePos:C.basePos,baseAlpha:C.baseAlpha,baseSat:C.baseSat,baseLight:C.baseLight,rules:C.rules,pattern:C.pattern,patterns:C.patterns,harmonyMode:C.harmonyMode,arpeggioWindowMs:C.arpeggioWindowMs,dynamicRanges:C.dynamicRanges }) }; }

export function mountReactiveColorUI(){
  hookSend(); loadCustomPresets(); if(document.getElementById("mo-reactive-color")) return { box: document.getElementById("mo-reactive-color") };
  const box=document.createElement("div"); box.id="mo-reactive-color";
  Object.assign(box.style,{position:"fixed",right:"12px",bottom:"72px",zIndex:999999,width:"620px",maxWidth:"calc(100vw - 24px)",maxHeight:"76vh",overflow:"hidden",resize:"both",background:"rgba(17,17,17,.96)",color:"#eee",padding:"10px",borderRadius:"10px",fontFamily:"system-ui",boxShadow:"0 10px 30px rgba(0,0,0,.6)"});
  box.innerHTML=`
  <style>
    #mo-reactive-color *{box-sizing:border-box}.mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;user-select:none;cursor:pointer}.mo-btn:hover,.mo-preset:hover{background:#353535}.mo-btn.active{background:#2f8f55}.mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}.mo-rc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mo-rc-small{font-size:12px;opacity:.72}.mo-rc-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.mo-preset{background:#242424;color:#eee;border:1px solid #3b3b3b;border-radius:9px;padding:10px 8px;text-align:center;cursor:pointer}.mo-preset.active{background:#67335a;border-color:#d35aae}.mo-rc-palette{display:flex;gap:3px;margin-top:8px}.mo-rc-swatch{height:16px;flex:1;border-radius:4px;border:1px solid rgba(255,255,255,.18)}#mo-rc-body{max-height:calc(76vh - 45px);overflow:auto;padding-right:6px}#mo-rc-preview{height:28px;border-radius:8px;background:#7c4dffcc;box-shadow:0 0 16px #7c4dffcc;margin-top:8px}#mo-rc-inspector{margin-top:8px;padding:8px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:9px}.monitor-head{display:flex;gap:7px;align-items:center}.monitor-title,.mo-meter-title{font-weight:700}.monitor-color{width:18px;height:18px;border-radius:5px;border:1px solid rgba(255,255,255,.25);box-shadow:0 0 12px currentColor}.monitor-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin-top:7px}.monitor-grid div{display:flex;justify-content:space-between;gap:6px;background:rgba(0,0,0,.18);border-radius:6px;padding:4px 6px}.monitor-grid span,.trace-row span{opacity:.65}.trace-title{margin-top:8px;font-weight:700}.trace-row{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}#mo-rc-expert{display:none;margin-top:10px;border-top:1px solid #333;padding-top:10px}#mo-rc-expert.open{display:block}#mo-rc-expert label{font-size:12px;opacity:.84}.expert-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.expert-grid input,.expert-grid select{width:100%;background:#1b1b1b;color:#eee;border:1px solid #3b3b3b;border-radius:8px;padding:6px}.mo-rule{display:grid;grid-template-columns:1.2fr auto 1.2fr 1fr 1fr auto auto;gap:6px;align-items:center;margin:5px 0}.mo-pattern{display:grid;grid-template-columns:1fr auto 1fr 1fr 0.8fr auto;gap:6px;align-items:center;margin:5px 0}.mo-pattern select,.mo-pattern input,.mo-rule select,.mo-rule input{background:#1b1b1b;color:#eee;border:1px solid #3b3b3b;border-radius:7px;padding:5px;width:100%}.small{padding:4px 8px}.color-grid{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.color-cell{display:flex;gap:3px;align-items:center}.color-cell input{width:34px;height:30px;background:none;border:0}.section{margin-top:10px;padding:8px;background:rgba(255,255,255,.035);border-radius:9px}.section-title{font-weight:700;margin-bottom:6px}
  </style>
  <div id="mo-rc-hdr" style="display:flex;gap:8px;align-items:center;cursor:move;user-select:none"><strong>Reactive Note Color</strong><span id="mo-rc-status" class="mo-chip" style="margin-left:auto">OFF</span></div>
  <div id="mo-rc-body">
    <div class="mo-rc-row" style="margin-top:8px"><button id="mo-rc-toggle" class="mo-btn">OFF</button><button id="mo-rc-monitor-toggle" class="mo-btn">Monitor</button><button id="mo-rc-expert-toggle" class="mo-btn">Expert / Custom ▾</button></div>
    <div id="mo-rc-current" style="font-weight:700;margin-top:9px"></div><div id="mo-rc-presets" class="mo-rc-presets"></div><div id="mo-rc-palette" class="mo-rc-palette"></div><div id="mo-rc-preview"></div><div id="mo-rc-inspector"></div>
    <div id="mo-rc-expert">
      <div class="mo-rc-row"><button id="blank" class="mo-btn">Blank</button><button id="save" class="mo-btn">Save preset</button><button id="delete" class="mo-btn">Delete custom</button><input id="presetName" placeholder="Preset name" style="flex:1;background:#1b1b1b;color:#eee;border:1px solid #3b3b3b;border-radius:8px;padding:6px"></div>
      <div class="section"><div class="section-title">Palette</div><div id="mo-rc-palette-editor" class="color-grid"></div><div class="mo-rc-row"><button class="mo-btn small" data-lib="inferno">Inferno</button><button class="mo-btn small" data-lib="royal">Royal</button><button class="mo-btn small" data-lib="spectrum">Spectrum</button><button class="mo-btn small" data-lib="aurora">Aurora</button><button class="mo-btn small" data-lib="ghost">Ghost</button><button class="mo-btn small" data-lib="noir">Noir</button><button class="mo-btn small" data-lib="acid">Acid</button><button class="mo-btn small" data-lib="solar">Solar</button><button class="mo-btn small" data-lib="starlight">Starlight</button><button class="mo-btn small" data-lib="brass">Brass</button><button class="mo-btn small" data-lib="obsidianKeys">Obsidian Keys</button><button class="mo-btn small" data-lib="leftRightElegance">Split Stage</button><button class="mo-btn small" data-lib="cinema">Cinema</button><button class="mo-btn small" data-lib="neonScanner">Neon</button><button class="mo-btn small" data-lib="monochromeGold">Gold</button></div></div>
      <div class="section"><div class="section-title">Modulation Matrix</div><div id="mo-rc-rules"></div><button id="addRule" class="mo-btn">+ Add modulation</button></div>
      <div class="section"><div class="section-title">Time Pattern Layers</div><div id="mo-rc-patterns"></div><button id="addPattern" class="mo-btn">+ Add time pattern</button></div>
      <div class="section"><div class="section-title">Base / Range / Performance</div><div class="expert-grid"><label><input id="dynamicRanges" type="checkbox" style="width:auto"> Auto-normalize live ranges</label><label>Base palette pos<input id="basePos" type="number" min="0" max="1" step="0.01"></label><label>Base alpha<input id="baseAlpha" type="number" min="0" max="1" step="0.01"></label><label>Base saturation<input id="baseSat" type="number" min="0.05" max="3" step="0.05"></label><label>Base light<input id="baseLight" type="number" min="0.05" max="3" step="0.05"></label><label>Min note<input id="minNote" type="number" min="0" max="127"></label><label>Max note<input id="maxNote" type="number" min="0" max="127"></label><label>Min alpha<input id="minAlpha" type="number" min="0" max="255"></label><label>Max alpha<input id="maxAlpha" type="number" min="0" max="255"></label><label>Update ms<input id="speed" type="number" min="250" max="2000" step="10"></label><label>Harmony mode<select id="harmonyMode"><option value="active">Active notes only</option><option value="memory">Arpeggio memory</option><option value="sustainAware">Sustain-aware</option><option value="hybrid">Hybrid</option></select></label><label>Arpeggio window ms<input id="arpeggioWindow" type="number" min="80" max="2500" step="10"></label><label>Smoothing<input id="smoothAmt" type="number" min="0.01" max="1" step="0.01"></label><label><input id="smoothColor" type="checkbox" style="width:auto"> Smooth color</label></div></div>
    </div>
  </div>`;
  document.body.appendChild(box); const hdr=box.querySelector("#mo-rc-hdr"); addMinimizer(box,hdr,"reactive-color"); makeDraggable(box,hdr); S.panel=box; S.status=box.querySelector("#mo-rc-status"); S.preview=box.querySelector("#mo-rc-preview"); S.inspector=box.querySelector("#mo-rc-inspector");
  box.querySelector("#mo-rc-toggle").onclick=()=>{ C.enabled=!C.enabled; setReactiveGlobalFlag(); sync(box); updateUI(); };
  box.querySelector("#mo-rc-monitor-toggle").onclick=()=>{ C.showMonitor=!C.showMonitor; sync(box); updateUI(); };
  box.querySelector("#mo-rc-expert-toggle").onclick=()=>{ const ex=box.querySelector("#mo-rc-expert"); ex.classList.toggle("open"); box.querySelector("#mo-rc-expert-toggle").textContent=ex.classList.contains("open")?"Expert / Custom ▴":"Expert / Custom ▾"; };
  box.querySelector("#blank").onclick=()=>{ applyConfig(BLANK_CONFIG,"custom"); box.querySelector("#presetName").value=""; sync(box); };
  box.querySelector("#addRule").onclick=()=>{ C.rules.push({input:"velocity",output:"alpha",amount:1,curve:"linear",invert:false}); renderRules(box); };
  box.querySelector("#addPattern").onclick=()=>{ if(!Array.isArray(C.patterns)) C.patterns=activePatterns(); C.patterns.push({type:"pulse", output:"alpha", amount:0.2, periodMs:1200}); C.pattern=C.patterns[0]; renderPatterns(box); syncActiveOnly(box); };
  box.querySelector("#save").onclick=()=>{ readExpertNumbers(box); const name=(box.querySelector("#presetName").value||"Custom").trim(); const id=name.toLowerCase().replace(/[^a-z0-9_-]+/gi,"-").replace(/^-|-$/g,"")||"custom"; S.customPresets[id]=serializeCurrent(name); saveCustomPresets(); C.preset="custom:"+id; renderPresetButtons(box); sync(box); updateUI("saved"); };
  box.querySelector("#delete").onclick=()=>{ if(!String(C.preset).startsWith("custom:")) return; delete S.customPresets[C.preset.slice(7)]; saveCustomPresets(); applyConfig(BUILTIN.royal.config,"builtin:royal"); renderPresetButtons(box); sync(box); };
  box.querySelectorAll("[data-lib]").forEach(btn=>btn.onclick=()=>{ C.palette=[...PALETTE_LIBRARY[btn.dataset.lib]]; renderPaletteEditor(box); syncActiveOnly(box); });
  box.querySelectorAll("#mo-rc-expert input,#mo-rc-expert select").forEach(el=>{ if(!["presetName"].includes(el.id)) el.onchange=()=>{ readExpertNumbers(box); syncActiveOnly(box); }; });
  renderPresetButtons(box); C.preset="builtin:royal"; sync(box); setReactiveGlobalFlag(); updateUI(); return { box };
}
