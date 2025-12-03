// vite-plugin-meta-images.js
import fs from "fs";
import path from "path";

/**
 * Vite plugin that updates og:image and twitter:image meta tags
 * to point to the app's opengraph image with the correct deployment domain.
 */
export function metaImagesPlugin() {
  return {
    name: "vite-plugin-meta-images",
    transformIndexHtml(html) {
      const baseUrl = getDeploymentUrl();
      if (!baseUrl) {
        log(
          "[meta-images] no deployment domain found, skipping meta tag updates"
        );
        return html;
      }

      const publicDir = path.resolve(process.cwd(), "client", "public");
      const pngPath = path.join(publicDir, "opengraph.png");
      const jpgPath = path.join(publicDir, "opengraph.jpg");
      const jpegPath = path.join(publicDir, "opengraph.jpeg");

      let imageExt = null;
      if (fs.existsSync(pngPath)) imageExt = "png";
      else if (fs.existsSync(jpgPath)) imageExt = "jpg";
      else if (fs.existsSync(jpegPath)) imageExt = "jpeg";

      if (!imageExt) {
        log(
          "[meta-images] OpenGraph image not found, skipping meta tag updates"
        );
        return html;
      }

      const imageUrl = `${baseUrl}/opengraph.${imageExt}`;
      log("[meta-images] updating meta image tags to:", imageUrl);

      html = html.replace(
        /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/g,
        `<meta property="og:image" content="${imageUrl}" />`
      );

      html = html.replace(
        /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/g,
        `<meta name="twitter:image" content="${imageUrl}" />`
      );

      return html;
    },
  };
}

function getDeploymentUrl() {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    const url = `https://${process.env.REPLIT_INTERNAL_APP_DOMAIN}`;
    log("[meta-images] using internal app domain:", url);
    return url;
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    const url = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    log("[meta-images] using dev domain:", url);
    return url;
  }

  // Fallback: nothing (local dev usually doesn’t need OG rewriting)
  return null;
}

function log(...args) {
  if (process.env.NODE_ENV === "production") {
    console.log(...args);
  }
}
