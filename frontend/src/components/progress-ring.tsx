import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { fonts, useTheme } from "@/src/theme";

export function ProgressRing({
  size = 120,
  strokeWidth = 12,
  progress,
  label,
  sublabel,
}: {
  size?: number;
  strokeWidth?: number;
  progress: number; // 0..1
  label: string;
  sublabel?: string;
}) {
  const { colors } = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.brandSecondary}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.brandPrimary}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={{ color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: size * 0.24 }}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 }}>{sublabel}</Text>
      ) : null}
    </View>
  );
}
