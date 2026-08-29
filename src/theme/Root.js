import React, { useEffect, useState } from 'react';

export default function Root({ children }) {
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 500);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {children}
      <button
        type="button"
        className={`backToTopButton ${showBackToTop ? 'backToTopButtonVisible' : ''}`}
        aria-label="Go to top"
        title="Go to top"
        onClick={scrollToTop}
      >
        ↑
      </button>
    </>
  );
}
