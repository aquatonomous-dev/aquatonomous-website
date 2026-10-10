export interface SeaState {
  id: string;
  label: string;
  /** Wind speed at 10 m, or null to use the Gazebo world's value. */
  windSpeed: number | null;
}

export const SEA_STATES: SeaState[] = [
  { id: "gazebo", label: "Gazebo world", windSpeed: null },
  { id: "light", label: "Light breeze, 3 m/s", windSpeed: 3 },
  { id: "moderate", label: "Moderate breeze, 5 m/s", windSpeed: 5 },
  { id: "fresh", label: "Fresh breeze, 7 m/s", windSpeed: 7 },
];
