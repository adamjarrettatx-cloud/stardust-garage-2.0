'use client';

// A fixed, pointer-events-none starfield that sits behind all content.
// Pure CSS animation — no JS, no external images. Performant and subtle.
export default function CosmosBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          'radial-gradient(ellipse at top, #0f0f1a 0%, #0a0a0a 60%, #070710 100%)',
      }}
    >
      {/* Layer 1: tiny distant stars (dim, slow twinkle) */}
      <svg
        className="absolute inset-0 w-full h-full opacity-60"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1600 1200"
      >
        {tinyStars.map((s, i) => (
          <circle
            key={`tiny-${i}`}
            cx={s.x}
            cy={s.y}
            r="0.6"
            fill="#ffffff"
            style={{
              animation: `cosmos-twinkle-slow ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </svg>

      {/* Layer 2: small stars (medium brightness, medium pulse) */}
      <svg
        className="absolute inset-0 w-full h-full opacity-80"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1600 1200"
      >
        {smallStars.map((s, i) => (
          <circle
            key={`small-${i}`}
            cx={s.x}
            cy={s.y}
            r="1"
            fill="#ffffff"
            style={{
              animation: `cosmos-twinkle-med ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </svg>

      {/* Layer 3: a few bright stars (brightest, slower soft pulse) */}
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1600 1200"
      >
        {brightStars.map((s, i) => (
          <g
            key={`bright-${i}`}
            style={{
              animation: `cosmos-twinkle-bright ${s.dur}s ease-in-out ${s.delay}s infinite`,
              transformOrigin: `${s.x}px ${s.y}px`,
            }}
          >
            <circle cx={s.x} cy={s.y} r="1.4" fill="#ffffff" />
            {/* subtle glow */}
            <circle cx={s.x} cy={s.y} r="3" fill="#ffffff" opacity="0.12" />
          </g>
        ))}
      </svg>

      <style jsx>{`
        @keyframes cosmos-twinkle-slow {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.9; }
        }
        @keyframes cosmos-twinkle-med {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes cosmos-twinkle-bright {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// Pre-generated star positions. Using a fixed set so server + client render
// the same thing (no hydration mismatch), and so the field is consistent.

// ~180 tiny stars
const tinyStars = [
  { x: 45, y: 120, dur: 4.2, delay: 0 }, { x: 180, y: 60, dur: 5.1, delay: 1.2 },
  { x: 310, y: 200, dur: 3.8, delay: 0.5 }, { x: 450, y: 80, dur: 5.5, delay: 2.1 },
  { x: 600, y: 150, dur: 4.7, delay: 0.8 }, { x: 720, y: 40, dur: 4.0, delay: 1.5 },
  { x: 880, y: 180, dur: 5.3, delay: 0.3 }, { x: 1010, y: 90, dur: 4.5, delay: 2.4 },
  { x: 1150, y: 220, dur: 4.9, delay: 0.7 }, { x: 1290, y: 50, dur: 5.0, delay: 1.9 },
  { x: 1430, y: 170, dur: 4.3, delay: 0.2 }, { x: 1560, y: 100, dur: 5.2, delay: 1.6 },
  { x: 70, y: 280, dur: 4.6, delay: 2.0 }, { x: 220, y: 340, dur: 5.4, delay: 0.4 },
  { x: 360, y: 300, dur: 3.9, delay: 1.3 }, { x: 510, y: 380, dur: 4.8, delay: 0.9 },
  { x: 650, y: 310, dur: 5.1, delay: 2.2 }, { x: 790, y: 360, dur: 4.4, delay: 0.6 },
  { x: 930, y: 290, dur: 4.7, delay: 1.8 }, { x: 1080, y: 370, dur: 5.3, delay: 0.1 },
  { x: 1220, y: 320, dur: 4.1, delay: 1.4 }, { x: 1370, y: 400, dur: 5.0, delay: 2.3 },
  { x: 1510, y: 310, dur: 4.5, delay: 0.8 }, { x: 30, y: 480, dur: 4.9, delay: 1.7 },
  { x: 170, y: 520, dur: 4.2, delay: 0.5 }, { x: 310, y: 460, dur: 5.5, delay: 2.1 },
  { x: 440, y: 540, dur: 3.8, delay: 1.0 }, { x: 580, y: 490, dur: 4.7, delay: 0.3 },
  { x: 720, y: 560, dur: 5.2, delay: 1.9 }, { x: 870, y: 470, dur: 4.3, delay: 0.7 },
  { x: 1000, y: 550, dur: 4.8, delay: 2.0 }, { x: 1140, y: 500, dur: 5.0, delay: 1.1 },
  { x: 1280, y: 580, dur: 4.4, delay: 0.4 }, { x: 1420, y: 490, dur: 5.3, delay: 1.5 },
  { x: 1560, y: 540, dur: 4.0, delay: 0.9 }, { x: 60, y: 640, dur: 4.6, delay: 2.2 },
  { x: 200, y: 700, dur: 5.1, delay: 0.6 }, { x: 340, y: 660, dur: 4.4, delay: 1.3 },
  { x: 480, y: 730, dur: 5.4, delay: 0.2 }, { x: 620, y: 680, dur: 3.9, delay: 1.8 },
  { x: 760, y: 740, dur: 4.8, delay: 0.5 }, { x: 900, y: 670, dur: 5.0, delay: 2.1 },
  { x: 1040, y: 720, dur: 4.3, delay: 1.0 }, { x: 1180, y: 680, dur: 4.7, delay: 0.7 },
  { x: 1320, y: 750, dur: 5.2, delay: 1.6 }, { x: 1460, y: 690, dur: 4.1, delay: 0.3 },
  { x: 1570, y: 760, dur: 5.3, delay: 1.9 }, { x: 90, y: 820, dur: 4.5, delay: 1.1 },
  { x: 230, y: 870, dur: 4.9, delay: 2.0 }, { x: 380, y: 830, dur: 4.2, delay: 0.6 },
  { x: 520, y: 900, dur: 5.4, delay: 1.3 }, { x: 660, y: 840, dur: 3.8, delay: 0.9 },
  { x: 800, y: 890, dur: 5.1, delay: 2.2 }, { x: 940, y: 820, dur: 4.6, delay: 0.4 },
  { x: 1080, y: 880, dur: 4.8, delay: 1.5 }, { x: 1220, y: 830, dur: 4.3, delay: 0.8 },
  { x: 1360, y: 910, dur: 5.0, delay: 1.7 }, { x: 1500, y: 850, dur: 4.4, delay: 2.3 },
  { x: 50, y: 980, dur: 4.7, delay: 0.5 }, { x: 190, y: 1040, dur: 5.2, delay: 1.2 },
  { x: 330, y: 990, dur: 4.0, delay: 0.3 }, { x: 470, y: 1060, dur: 5.3, delay: 1.8 },
  { x: 610, y: 1000, dur: 4.5, delay: 2.1 }, { x: 750, y: 1070, dur: 4.9, delay: 0.7 },
  { x: 890, y: 1010, dur: 4.2, delay: 1.4 }, { x: 1030, y: 1080, dur: 5.4, delay: 0.2 },
  { x: 1170, y: 1020, dur: 3.8, delay: 1.9 }, { x: 1310, y: 1090, dur: 4.6, delay: 0.5 },
  { x: 1450, y: 1030, dur: 5.0, delay: 2.0 }, { x: 1580, y: 1100, dur: 4.3, delay: 1.1 },
  { x: 140, y: 150, dur: 4.8, delay: 0.9 }, { x: 280, y: 90, dur: 5.1, delay: 2.2 },
  { x: 420, y: 220, dur: 4.4, delay: 0.4 }, { x: 560, y: 70, dur: 4.7, delay: 1.6 },
  { x: 700, y: 190, dur: 5.2, delay: 0.8 }, { x: 840, y: 110, dur: 4.1, delay: 2.0 },
  { x: 980, y: 230, dur: 4.9, delay: 0.3 }, { x: 1120, y: 130, dur: 5.3, delay: 1.5 },
  { x: 1260, y: 210, dur: 4.3, delay: 0.6 }, { x: 1400, y: 80, dur: 4.6, delay: 2.1 },
  { x: 1540, y: 190, dur: 5.0, delay: 1.0 }, { x: 100, y: 360, dur: 4.2, delay: 1.7 },
  { x: 250, y: 410, dur: 5.4, delay: 0.2 }, { x: 390, y: 330, dur: 3.9, delay: 1.3 },
  { x: 540, y: 420, dur: 4.8, delay: 0.9 }, { x: 680, y: 340, dur: 5.1, delay: 2.2 },
  { x: 820, y: 400, dur: 4.5, delay: 0.5 }, { x: 960, y: 330, dur: 4.7, delay: 1.8 },
  { x: 1100, y: 410, dur: 5.3, delay: 0.1 }, { x: 1240, y: 340, dur: 4.0, delay: 1.4 },
  { x: 1380, y: 430, dur: 4.9, delay: 2.3 }, { x: 1520, y: 350, dur: 4.4, delay: 0.8 },
  { x: 120, y: 560, dur: 5.0, delay: 1.2 }, { x: 260, y: 500, dur: 4.3, delay: 2.0 },
  { x: 400, y: 580, dur: 5.2, delay: 0.6 }, { x: 550, y: 510, dur: 3.8, delay: 1.7 },
  { x: 690, y: 590, dur: 4.7, delay: 0.4 }, { x: 830, y: 520, dur: 5.4, delay: 1.9 },
  { x: 970, y: 600, dur: 4.1, delay: 0.7 }, { x: 1110, y: 530, dur: 4.6, delay: 2.1 },
  { x: 1250, y: 610, dur: 5.1, delay: 1.0 }, { x: 1390, y: 540, dur: 4.5, delay: 0.3 },
  { x: 1530, y: 620, dur: 4.8, delay: 1.6 }, { x: 75, y: 760, dur: 5.3, delay: 2.3 },
  { x: 215, y: 720, dur: 4.2, delay: 0.8 }, { x: 355, y: 790, dur: 4.9, delay: 1.1 },
  { x: 495, y: 730, dur: 5.0, delay: 2.0 }, { x: 635, y: 800, dur: 3.9, delay: 0.5 },
  { x: 775, y: 740, dur: 4.6, delay: 1.3 }, { x: 915, y: 810, dur: 5.2, delay: 0.2 },
  { x: 1055, y: 750, dur: 4.3, delay: 1.8 }, { x: 1195, y: 820, dur: 4.7, delay: 0.9 },
  { x: 1335, y: 760, dur: 5.4, delay: 2.2 }, { x: 1475, y: 830, dur: 4.1, delay: 0.4 },
  { x: 110, y: 940, dur: 4.8, delay: 1.5 }, { x: 250, y: 970, dur: 5.3, delay: 0.7 },
  { x: 395, y: 950, dur: 4.0, delay: 2.0 }, { x: 535, y: 1020, dur: 5.1, delay: 1.1 },
  { x: 675, y: 960, dur: 4.4, delay: 0.3 }, { x: 815, y: 1030, dur: 4.7, delay: 1.6 },
  { x: 955, y: 970, dur: 5.0, delay: 0.8 }, { x: 1095, y: 1040, dur: 4.2, delay: 2.1 },
  { x: 1235, y: 980, dur: 4.9, delay: 1.0 }, { x: 1375, y: 1050, dur: 5.4, delay: 0.6 },
  { x: 1515, y: 990, dur: 3.8, delay: 1.9 }, { x: 40, y: 1120, dur: 4.5, delay: 0.1 },
  { x: 185, y: 1160, dur: 5.0, delay: 1.4 }, { x: 325, y: 1130, dur: 4.3, delay: 2.2 },
  { x: 465, y: 1170, dur: 4.8, delay: 0.5 }, { x: 605, y: 1140, dur: 5.2, delay: 1.8 },
  { x: 745, y: 1180, dur: 4.1, delay: 0.9 }, { x: 885, y: 1150, dur: 4.6, delay: 2.0 },
  { x: 1025, y: 1190, dur: 5.1, delay: 1.2 }, { x: 1165, y: 1160, dur: 4.4, delay: 0.4 },
  { x: 1305, y: 1180, dur: 4.7, delay: 1.7 }, { x: 1445, y: 1140, dur: 5.3, delay: 0.8 },
  { x: 1585, y: 1170, dur: 3.9, delay: 2.1 }, { x: 155, y: 230, dur: 4.2, delay: 1.3 },
  { x: 295, y: 170, dur: 5.0, delay: 0.6 }, { x: 435, y: 250, dur: 4.6, delay: 1.9 },
  { x: 575, y: 180, dur: 4.9, delay: 0.2 }, { x: 715, y: 260, dur: 5.2, delay: 1.1 },
  { x: 855, y: 200, dur: 4.3, delay: 2.0 }, { x: 995, y: 270, dur: 4.8, delay: 0.7 },
  { x: 1135, y: 180, dur: 5.4, delay: 1.4 }, { x: 1275, y: 250, dur: 4.0, delay: 0.5 },
  { x: 1415, y: 190, dur: 4.7, delay: 1.8 }, { x: 1555, y: 260, dur: 5.1, delay: 0.9 },
  { x: 65, y: 420, dur: 4.4, delay: 2.2 }, { x: 205, y: 380, dur: 5.3, delay: 1.0 },
  { x: 345, y: 450, dur: 3.8, delay: 0.3 }, { x: 485, y: 390, dur: 4.8, delay: 1.6 },
  { x: 625, y: 460, dur: 5.1, delay: 2.1 }, { x: 765, y: 400, dur: 4.2, delay: 0.8 },
  { x: 905, y: 470, dur: 4.7, delay: 1.5 }, { x: 1045, y: 410, dur: 5.0, delay: 0.4 },
  { x: 1185, y: 480, dur: 4.5, delay: 1.9 }, { x: 1325, y: 420, dur: 4.9, delay: 0.6 },
  { x: 1465, y: 490, dur: 5.3, delay: 2.0 },
];

// ~45 small stars
const smallStars = [
  { x: 120, y: 200, dur: 3.5, delay: 0.5 }, { x: 340, y: 130, dur: 4.2, delay: 1.8 },
  { x: 580, y: 260, dur: 3.8, delay: 0.2 }, { x: 820, y: 80, dur: 4.5, delay: 1.3 },
  { x: 1050, y: 240, dur: 3.6, delay: 2.1 }, { x: 1280, y: 140, dur: 4.0, delay: 0.8 },
  { x: 1500, y: 280, dur: 3.9, delay: 1.5 }, { x: 200, y: 460, dur: 4.3, delay: 0.3 },
  { x: 440, y: 380, dur: 3.7, delay: 1.9 }, { x: 680, y: 500, dur: 4.1, delay: 0.6 },
  { x: 920, y: 400, dur: 3.5, delay: 2.2 }, { x: 1160, y: 520, dur: 4.4, delay: 1.0 },
  { x: 1400, y: 430, dur: 3.8, delay: 0.4 }, { x: 80, y: 680, dur: 4.2, delay: 1.7 },
  { x: 300, y: 620, dur: 3.9, delay: 0.9 }, { x: 540, y: 720, dur: 4.5, delay: 2.0 },
  { x: 780, y: 640, dur: 3.6, delay: 0.7 }, { x: 1020, y: 740, dur: 4.1, delay: 1.4 },
  { x: 1260, y: 660, dur: 3.7, delay: 0.1 }, { x: 1490, y: 780, dur: 4.3, delay: 1.8 },
  { x: 160, y: 880, dur: 3.9, delay: 0.5 }, { x: 400, y: 820, dur: 4.0, delay: 2.1 },
  { x: 640, y: 920, dur: 3.8, delay: 1.2 }, { x: 880, y: 860, dur: 4.4, delay: 0.3 },
  { x: 1120, y: 940, dur: 3.5, delay: 1.6 }, { x: 1360, y: 880, dur: 4.2, delay: 0.8 },
  { x: 1570, y: 960, dur: 3.9, delay: 2.3 }, { x: 240, y: 1060, dur: 4.3, delay: 0.6 },
  { x: 480, y: 1000, dur: 3.6, delay: 1.9 }, { x: 720, y: 1100, dur: 4.1, delay: 0.2 },
  { x: 960, y: 1040, dur: 3.8, delay: 1.5 }, { x: 1200, y: 1120, dur: 4.5, delay: 0.9 },
  { x: 1440, y: 1060, dur: 3.7, delay: 2.0 }, { x: 95, y: 330, dur: 4.2, delay: 1.1 },
  { x: 380, y: 290, dur: 3.9, delay: 0.4 }, { x: 620, y: 360, dur: 4.4, delay: 1.7 },
  { x: 860, y: 300, dur: 3.6, delay: 0.7 }, { x: 1100, y: 370, dur: 4.0, delay: 2.2 },
  { x: 1340, y: 310, dur: 3.8, delay: 1.3 }, { x: 1560, y: 380, dur: 4.3, delay: 0.5 },
  { x: 135, y: 540, dur: 3.7, delay: 1.8 }, { x: 370, y: 590, dur: 4.1, delay: 0.2 },
  { x: 610, y: 550, dur: 3.9, delay: 1.4 }, { x: 850, y: 600, dur: 4.5, delay: 0.8 },
  { x: 1090, y: 560, dur: 3.6, delay: 2.1 },
];

// ~15 bright stars (the accent stars)
const brightStars = [
  { x: 250, y: 180, dur: 3.2, delay: 0.4 }, { x: 620, y: 320, dur: 3.8, delay: 1.5 },
  { x: 1020, y: 110, dur: 3.5, delay: 2.1 }, { x: 1380, y: 260, dur: 3.6, delay: 0.7 },
  { x: 180, y: 510, dur: 3.9, delay: 1.9 }, { x: 540, y: 640, dur: 3.4, delay: 0.3 },
  { x: 880, y: 480, dur: 3.7, delay: 1.2 }, { x: 1240, y: 580, dur: 3.8, delay: 2.0 },
  { x: 1500, y: 450, dur: 3.5, delay: 0.6 }, { x: 380, y: 830, dur: 3.6, delay: 1.8 },
  { x: 760, y: 780, dur: 3.9, delay: 0.5 }, { x: 1120, y: 900, dur: 3.3, delay: 1.4 },
  { x: 1440, y: 810, dur: 3.7, delay: 2.1 }, { x: 290, y: 1050, dur: 3.5, delay: 0.8 },
  { x: 680, y: 1130, dur: 3.8, delay: 1.6 },
];
