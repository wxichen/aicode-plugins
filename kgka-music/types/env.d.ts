import '@jieapi/plugin-sdk/page';
import '@jieapi/plugin-sdk/page/vue';

declare module '*.webm' {
  const source: string;
  export default source;
}
