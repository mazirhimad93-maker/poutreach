import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'blue' | 'gold';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as Theme) || 'blue';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    
    // Apply theme classes to body
    document.body.className = '';
    if (theme === 'gold') {
      document.body.classList.add('theme-gold');
    } else {
      document.body.classList.add('theme-blue');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'blue' ? 'gold' : 'blue');
  };

  const value = {
    theme,
    setTheme,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}