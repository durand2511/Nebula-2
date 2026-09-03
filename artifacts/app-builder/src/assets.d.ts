// Audio assets imported as URLs (Vite bundles .m4a as a hashed asset).
declare module "*.m4a" {
  const url: string;
  export default url;
}
