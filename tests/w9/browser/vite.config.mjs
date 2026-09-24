import { defineConfig, transformWithOxc } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  resolve:{alias:{'@':root,'next/navigation':fileURLToPath(new URL('./navigation.js',import.meta.url))}},
  plugins:[{name:'next-jsx-files',enforce:'pre',async transform(code,id){
    if(id.endsWith('.js')&&!id.includes('node_modules'))return transformWithOxc(code,id,{lang:'jsx',jsx:{runtime:'automatic'}});
  }}],
  oxc:{jsx:{runtime:'automatic'}},
  css:{postcss:{plugins:[]}},
  optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']},
  server:{host:'127.0.0.1',port:3011,fs:{allow:[root]}},
});
