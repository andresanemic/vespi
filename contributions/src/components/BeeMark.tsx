import Image from 'next/image';
// Presentation only: preserve the authorized artwork and bring its lower orbit closer to the bee.
export default function BeeMark({size=38}:{size?:number}){return <span className="bee-mark" style={{width:size,height:size*.74}} aria-hidden="true"><Image className="bee-upper" src="/bee.png" alt="" width={240} height={205}/><Image className="bee-orbit" src="/bee.png" alt="" width={240} height={205}/></span>;}
