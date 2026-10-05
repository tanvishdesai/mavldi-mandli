/* Runs in <head>: tells CSS that JavaScript is available, before first paint.
   A file rather than an inline script so the Content-Security-Policy can stay
   at script-src 'self' with no inline allowance. */
document.documentElement.classList.replace('no-js', 'js');
