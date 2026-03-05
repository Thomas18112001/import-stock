type AppLoaderProps = {
  visible: boolean;
  ariaLabel?: string;
  logoSrc?: string;
  ringColor?: string;
};

export function AppLoader({
  visible,
  ariaLabel = "Chargement de l'application",
  logoSrc = "/logo.svg",
  ringColor = "#30547d",
}: AppLoaderProps) {
  const loaderSize = 120;
  const circleSize = 90;
  const logoSize = 62;
  return (
    <div className={`app-loader-overlay ${visible ? "is-visible" : "is-hidden"}`} aria-hidden={!visible}>
      <div
        className="app-loader"
        role="status"
        aria-label={ariaLabel}
        style={{ width: loaderSize, height: loaderSize, maxWidth: loaderSize, maxHeight: loaderSize }}
      >
        <div className="app-loader-ring" style={{ borderTopColor: ringColor, width: loaderSize, height: loaderSize }} />
        <div className="app-loader-circle" style={{ width: circleSize, height: circleSize, maxWidth: circleSize, maxHeight: circleSize }}>
          <img
            className="app-loader-logo"
            src={logoSrc}
            alt="Logo application"
            style={{ width: logoSize, height: logoSize, maxWidth: logoSize, maxHeight: logoSize }}
          />
        </div>
      </div>
    </div>
  );
}
