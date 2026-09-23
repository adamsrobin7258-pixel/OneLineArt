export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;
