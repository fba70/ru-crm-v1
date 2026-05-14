import Image from "next/image"

export default function ElectricCard() {
  return (
    <div className="relative bg-transparent text-[oklch(0.985_0_0)] overflow-hidden">
      <svg className="absolute">
        <defs>
          <filter
            id="turbulent-displace"
            colorInterpolationFilters="sRGB"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise1"
              seed="1"
            />
            <feOffset in="noise1" dx="0" dy="0" result="offsetNoise1">
              <animate
                attributeName="dy"
                values="700; 0"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise2"
              seed="1"
            />
            <feOffset in="noise2" dx="0" dy="0" result="offsetNoise2">
              <animate
                attributeName="dy"
                values="0; -700"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise1"
              seed="2"
            />
            <feOffset in="noise1" dx="0" dy="0" result="offsetNoise3">
              <animate
                attributeName="dx"
                values="490; 0"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise2"
              seed="2"
            />
            <feOffset in="noise2" dx="0" dy="0" result="offsetNoise4">
              <animate
                attributeName="dx"
                values="0; -490"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feComposite in="offsetNoise1" in2="offsetNoise2" result="part1" />
            <feComposite in="offsetNoise3" in2="offsetNoise4" result="part2" />
            <feBlend
              in="part1"
              in2="part2"
              mode="color-dodge"
              result="combinedNoise"
            />

            <feDisplacementMap
              in="SourceGraphic"
              in2="combinedNoise"
              scale="30"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </defs>
      </svg>

      <div className="p-[2px] rounded-xl relative bg-linear-to-r from-[oklch(from_#dd8448_0.3_calc(c/2)_h/0.4)] via-transparent to-[oklch(from_#dd8448_0.3_calc(c/2)_h/0.4)] bg-[oklch(0.185_0_0)]">
        <div className="relative">
          <div className="border-2 border-[rgba(221,132,72,0.5)] rounded-xl pr-1 pb-1">
            <div
              className="w-[350px] h-[500px] border-2 border-[#dd8448] rounded-xl -mt-1 -ml-1"
              style={{ filter: "url(#turbulent-displace)" }}
            ></div>
          </div>
          <div className="absolute inset-0 border-2 border-[rgba(221,132,72,0.6)] rounded-xl blur-[1px]"></div>
          <div className="absolute inset-0 border-2 border-[oklch(from_#dd8448_l_c_h)] rounded-xl blur-xs"></div>
        </div>

        <div className="absolute inset-0 rounded-xl opacity-100 mix-blend-overlay scale-100 bg-linear-to-r from-white via-transparent to-white"></div>
        <div className="absolute inset-0 rounded-xl opacity-50 mix-blend-overlay scale-100 bg-linear-to-r from-white via-transparent to-white"></div>

        <div className="absolute inset-0 rounded-xl blur-[32px] scale-110 opacity-30 -z-10 bg-linear-to-r from-[oklch(from_#dd8448_l_c_h)] via-transparent to-[#dd8448]"></div>

        <div className="absolute inset-0 w-full h-full flex flex-col">
          <div className="flex flex-col p-12 pb-4 h-full items-center justify-center">
            <Image src="/Avica_logo.png" alt="Logo" width={260} height={260} />
            <p className="text-6xl font-bold mt-auto bg-linear-to-r from-orange-500 via-pink-500 to-blue-400 bg-clip-text text-transparent">
              AVICA.AI
            </p>
          </div>

          <hr
            className="mt-auto border-none h-px bg-current opacity-10"
            style={{
              maskImage:
                "linear-gradient(to right, transparent, black, transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent, black, transparent)",
            }}
          />

          <div className="flex flex-col p-12 pt-4 items-center justify-center">
            <p className="text-gray-300">Your digital content at scale</p>
          </div>
        </div>
      </div>
    </div>
  )
}
