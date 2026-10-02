import React from 'react';
export function useRouter(){return {refresh:()=>window.dispatchEvent(new Event('fixture-refresh'))};}
export default function Link({href,children,...rest}){return <a href={href} {...rest}>{children}</a>;}
