interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 40, className = "" }: AppLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* macOS squircle background */}
      <rect
        x="100"
        y="100"
        width="824"
        height="824"
        rx="186"
        fill="url(#logo-gradient)"
      />

      {/* Bird on branch */}
      <g transform="translate(490, 500) scale(2.5) rotate(-10)">
        {/* Branch */}
        <path
          d="M-120 75 Q-40 65 40 80 Q100 90 140 70"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M60 82 Q80 95 90 115"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
        />

        {/* Bird tail feathers */}
        <path
          d="M-75 15 Q-115 -15 -120 -50 Q-95 -10 -75 0 Q-110 15 -115 50 Q-85 30 -75 15"
          fill="url(#bird-tail)"
        />

        {/* Bird body */}
        <ellipse cx="0" cy="10" rx="85" ry="70" fill="url(#bird-body)" />

        {/* Bird wing */}
        <path
          d="M-50 0 Q-70 -40 -25 -65 Q20 -50 35 5 Q5 20 -50 0"
          fill="url(#bird-wing)"
        />

        {/* Bird head */}
        <ellipse cx="65" cy="-25" rx="50" ry="45" fill="url(#bird-head)" />

        {/* Beak */}
        <path d="M108 -25 L138 -15 L108 -8 Z" fill="#e0a0a0" />

        {/* Eye */}
        <circle cx="80" cy="-32" r="6" fill="#5a5a7a" />
        <circle cx="82" cy="-34" r="2" fill="#ffffff" />

        {/* Sparkles */}
        <polygon
          points="130,-60 133,-50 143,-50 135,-43 138,-33 130,-40 122,-33 125,-43 117,-50 127,-50"
          fill="#ffffff"
          opacity="0.9"
        />
        <polygon
          points="-100,-40 -98,-33 -90,-33 -96,-28 -94,-20 -100,-25 -106,-20 -104,-28 -110,-33 -102,-33"
          fill="#ffffff"
          opacity="0.8"
        />
        <polygon
          points="50,-95 52,-89 58,-89 53,-85 55,-79 50,-83 45,-79 47,-85 42,-89 48,-89"
          fill="#ffffff"
          opacity="0.85"
        />
        <circle cx="140" cy="20" r="4" fill="#ffffff" opacity="0.7" />
        <circle cx="-85" cy="-70" r="3" fill="#ffffff" opacity="0.6" />
        <circle cx="110" cy="-85" r="2.5" fill="#ffffff" opacity="0.75" />

        {/* Bird legs */}
        <path
          d="M-10 72 L-10 85"
          stroke="#c8b0c8"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M20 74 L20 88"
          stroke="#c8b0c8"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>

      <defs>
        <linearGradient
          id="logo-gradient"
          x1="100"
          y1="100"
          x2="924"
          y2="924"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#312e81" />
          <stop offset="100%" stopColor="#581c87" />
        </linearGradient>

        <linearGradient
          id="bird-body"
          x1="-85"
          y1="80"
          x2="85"
          y2="-60"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f5b0b0" />
          <stop offset="100%" stopColor="#ecdcf0" />
        </linearGradient>

        <linearGradient
          id="bird-wing"
          x1="-70"
          y1="5"
          x2="35"
          y2="-65"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#d8c8ec" />
          <stop offset="100%" stopColor="#f8f0fc" />
        </linearGradient>

        <linearGradient
          id="bird-head"
          x1="15"
          y1="20"
          x2="115"
          y2="-70"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f0c0c0" />
          <stop offset="100%" stopColor="#fcf4fc" />
        </linearGradient>

        <linearGradient
          id="bird-tail"
          x1="-75"
          y1="50"
          x2="-120"
          y2="-50"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f5b0b0" />
          <stop offset="100%" stopColor="#e4d4ec" />
        </linearGradient>
      </defs>
    </svg>
  );
}
