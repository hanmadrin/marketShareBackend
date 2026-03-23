export const getGraphColor = (index) => {
  const colors = [
    "#00D4FF", "#FFB800", "#FF007A", "#C1FF00", "#A855F7",
    "#FF4D4D", "#00F5A0", "#FF6B00", "#4F46E5", "#10B981",
    "#3ABEF9", "#DC2626", "#EAB308", "#F472B6", "#0D9488",
    "#818CF8", "#FB923C", "#64748B", "#9333EA", "#CBD5E1"
  ];

  // Uses the modulo operator to cycle through the 20 colors
  return colors[index % 20];
}