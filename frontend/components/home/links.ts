export const REPO = "https://github.com/Parth-Vasave/pulse";
export const doc = (name: string) => `${REPO}/blob/main/docs/${name}.md`;

export const INSTALL = [
  "git clone https://github.com/Parth-Vasave/pulse.git",
  "cd pulse",
  "cp .env.example .env",
  "docker compose up --build",
];
