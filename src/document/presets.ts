/**
 * Figma's frame dimension presets.
 *
 * The list is Figma's own, in Figma's order and grouping, because the point of
 * a preset is that it is the size everyone else means by that name — a "Desktop"
 * that is not 1440 wide makes every review a conversation about the frame
 * instead of the design.
 */
export interface FramePreset {
  name: string;
  w: number;
  h: number;
  /** starts a new group in the menu */
  divider?: boolean;
}

export const FRAME_PRESETS: FramePreset[] = [
  { name: 'iPhone 17', w: 402, h: 874 },
  { name: 'iPhone 16 & 17 Pro', w: 402, h: 874 },
  { name: 'iPhone 16', w: 393, h: 852 },
  { name: 'iPhone 16 & 17 Pro Max', w: 440, h: 956 },
  { name: 'iPhone 16 Plus', w: 430, h: 932 },
  { name: 'iPhone Air', w: 420, h: 912 },
  { name: 'iPhone 14 & 15 Pro Max', w: 430, h: 932 },
  { name: 'iPhone 14 & 15 Pro', w: 393, h: 852 },
  { name: 'iPhone 13 & 14', w: 390, h: 844 },
  { name: 'iPhone 14 Plus', w: 428, h: 926 },
  { name: 'Android Compact', w: 412, h: 917 },
  { name: 'Android Medium', w: 700, h: 840 },

  { name: 'iPad mini 8.3', w: 744, h: 1133, divider: true },
  { name: 'Surface Pro 8', w: 1440, h: 960 },
  { name: 'iPad Pro 11"', w: 834, h: 1194 },
  { name: 'iPad Pro 12.9"', w: 1024, h: 1366 },
  { name: 'Android Expanded', w: 1280, h: 800 },

  { name: 'MacBook Air', w: 1280, h: 832, divider: true },
  { name: 'MacBook Pro 14"', w: 1512, h: 982 },
  { name: 'MacBook Pro 16"', w: 1728, h: 1117 },
  { name: 'Desktop', w: 1440, h: 1024 },
  { name: 'Wireframes', w: 1440, h: 1024 },
  { name: 'TV', w: 1280, h: 720 },

  { name: 'Slide 16:9', w: 1920, h: 1080, divider: true },
  { name: 'Slide 4:3', w: 1024, h: 768 },

  { name: 'Apple Watch Series 10 46mm', w: 187, h: 223, divider: true },
  { name: 'Apple Watch Series 10 42mm', w: 208, h: 248 },
  { name: 'Apple Watch 41mm', w: 176, h: 215 },
  { name: 'Apple Watch 45mm', w: 198, h: 242 },
  { name: 'Apple Watch 44mm', w: 184, h: 224 },
  { name: 'Apple Watch 40mm', w: 162, h: 197 },

  { name: 'A4', w: 595, h: 842, divider: true },
  { name: 'A5', w: 420, h: 595 },
  { name: 'A6', w: 297, h: 420 },
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Tabloid', w: 792, h: 1224 },

  { name: 'Twitter post', w: 1200, h: 675, divider: true },
  { name: 'Twitter header', w: 1500, h: 500 },
  { name: 'Facebook post', w: 1200, h: 630 },
  { name: 'Facebook cover', w: 820, h: 312 },
  { name: 'Instagram post', w: 1080, h: 1350 },
  { name: 'Instagram story', w: 1080, h: 1920 },
];
