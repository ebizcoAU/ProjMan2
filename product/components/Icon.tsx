const paths: Record<string, string> = {
  layers:
    "M12 2 2 7l10 5 10-5-10-5Zm0 10L2 12l10 5 10-5-10 0Zm0 5L2 17l10 5 10-5-10 0Z",
  "shield-check": "M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3Zm-1.2 13-3.3-3.3 1.4-1.4 1.9 1.9 4.4-4.4 1.4 1.4-5.8 5.8Z",
  fingerprint:
    "M12 2a10 10 0 0 0-7 17.1l1.4-1.4A8 8 0 0 1 12 4a8 8 0 0 1 8 8c0 2-.6 3.4-1.5 4.9l1.6 1.2C21.2 16.4 22 14.3 22 12A10 10 0 0 0 12 2Zm0 4a6 6 0 0 0-6 6c0 3 1.6 5 3 6.4l1.4-1.4C9.2 15.8 8 14.3 8 12a4 4 0 0 1 8 0c0 1-.2 1.9-.6 2.7l1.7 1c.6-1.1.9-2.3.9-3.7a6 6 0 0 0-6-6Zm0 4a2 2 0 0 0-2 2c0 1.6.9 2.9 2 4l1.4-1.4c-.8-.8-1.4-1.6-1.4-2.6a1 1 0 0 1 2 0c0 .3 0 .6-.1.9l1.9.6c.1-.5.2-1 .2-1.5a2 2 0 0 0-2-2Z",
  network:
    "M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM4 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm16 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 8v4m0 0-6 5m6-5 6 5",
  chart: "M4 20V10m6 10V4m6 16v-7",
  badge: "M12 2 3 6v6c0 5 3.8 9.3 9 10 5.2-.7 9-5 9-10V6l-9-4Zm0 5 3 6h-6l3-6Z",
  "map-pin":
    "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z",
  gate: "M4 4h4v16H4V4Zm12 0h4v16h-4V4ZM10 8h4M10 12h4M10 16h4",
  accessibility:
    "M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM4 9h16v2h-6.4l3 9-1.9.6-2.7-8H10l-2.7 8-1.9-.6 3-9H4V9Z",
  check: "M20 6 9 17l-5-5",
  arrow: "M5 12h13m0 0-6-6m6 6-6 6",
  "qr-code": "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v6h-6v-2h4v-4Zm-4 4h2v2h-2v-2Z",
  users: "M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20c0-3 3-5.5 6-5.5s6 2.5 6 5.5H2Zm12.5-5.4c2.6.4 5.5 2.6 5.5 5.4h-4",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm1-15v5.4l4 2.4-1 1.7-5-3V7h2Z",
  lock: "M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z",
  search: "M11 4a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.9 9h-3.4c-.1-2-.5-3.8-1.1-5.2A8 8 0 0 1 19.9 11ZM12 4c.8 1 1.6 3 1.8 7H10.2c.2-4 1-6 1.8-7ZM4.1 11a8 8 0 0 1 4.5-5.2C7.9 7.2 7.5 9 7.4 11H4.1Zm0 2h3.3c.1 2 .5 3.8 1.2 5.2A8 8 0 0 1 4.1 13Zm7.9 7c-.8-1-1.6-3-1.8-7h3.6c-.2 4-1 6-1.8 7Zm3.4-1.8c.6-1.4 1-3.2 1.1-5.2h3.4a8 8 0 0 1-4.5 5.2Z",
  calendar: "M4 4h16v16H4V4Zm0 5h16M8 2v4m8-4v4M7 13h2m3 0h2m3 0h2M7 17h2m3 0h2",
  document: "M6 2h8l4 4v16H6V2Zm8 0v4h4M9 12h6M9 16h6",
  ticket: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Zm9-2v2m0 3v2m0 3v2",
  "list-checks": "M9 6h11M9 12h11M9 18h11M3.5 6l1.2 1.2L6.5 5M3.5 12l1.2 1.2 1.8-2M3.5 18l1.2 1.2 1.8-2",
  "alert-triangle": "M12 2 2 20h20L12 2Zm0 7v5m0 3.5h.01",
  image: "M4 5h16v14H4V5Zm3 10 3.5-4 2.5 3 2-2.5L19 15H7Zm2-7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
  bug: "M9 4h6M9 4a3 3 0 0 1 6 0M6 9h12M6 9a6 6 0 0 0 12 0M6 9v6a6 6 0 0 0 12 0V9M4 12h2m12 0h2M4 17l2-2m12 2-2-2",
  "help-circle": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.4-10.3a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.3.9-1.3 1.9v.2M12 17h.01",
  upload: "M12 3v12m0-12 4 4m-4-4-4 4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  stamp: "M9 3h6l1 5H8l1-5Zm-1 5h8v5H8V8Zm-4 7h16l1 4H3l1-4Z",
  workflow: "M4 6h5v4H4V6Zm11 0h5v4h-5V6ZM9 8h6M6 10v4m12-4v4M4 14h5v4H4v-4Zm11 0h5v4h-5v-4Z",
  message: "M4 4h16v13H8l-4 4V4Z",
  "user-check": "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6H3Zm13-9 2 2 4-4",
  siren: "M12 2a5 5 0 0 0-5 5v5H5v3h14v-3h-2V7a5 5 0 0 0-5-5Zm-3 15h6v3H9v-3Z",
  bot: "M9 7V5a3 3 0 1 1 6 0v2M5 9h14v10H5V9Zm3.5 4.5h.01M14.5 13.5h.01M9 17h6",
  umbrella: "M12 2a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Zm0 0v17a2 2 0 0 1-4 0",
};

export function Icon({
  name,
  className = "h-6 w-6",
}: {
  name: keyof typeof paths;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.check} />
    </svg>
  );
}
