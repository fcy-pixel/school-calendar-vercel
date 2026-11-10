/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir:
    process.env.NODE_ENV === "development" &&
    process.env.CALENDAR_UI_PREVIEW === "1"
      ? ".next-preview"
      : ".next",
};
module.exports = nextConfig;
