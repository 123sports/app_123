import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { playPop } from "@/lib/sfx";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("ontennis-theme");
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefers;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    playPop();
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("ontennis-theme", next ? "dark" : "light");
  };

  return (
    <button
      onClick={toggle}
      aria-label="Alternar tema"
      className="btn-bounce inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-secondary"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
