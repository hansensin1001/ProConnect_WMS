import Link from "next/link";
import {
  ArrowRight,
  Barcode,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Mail,
  MapPinned,
  MessageCircle,
  PackageCheck,
  Phone,
  ScanLine,
  Truck,
} from "lucide-react";

const capabilities = [
  { icon: Boxes, title: "Live inventory control", text: "Know available, reserved, inbound and quarantined stock by exact warehouse bin." },
  { icon: ScanLine, title: "Fast, accurate picking", text: "Barcode and serial validation stops mispicks before stock leaves the warehouse." },
  { icon: Truck, title: "Inbound to outbound", text: "Receive purchase orders, allocate sales orders, create AWBs and track every movement." },
  { icon: ClipboardCheck, title: "Traceable operations", text: "Manage returns, cycle counts and audit trails without losing the document history." },
];

const workflow = [
  ["01", "Receive", "Check incoming goods against a purchase order and put them away into the right bin."],
  ["02", "Control", "See every SKU, serial number and stock state across locations in real time."],
  ["03", "Fulfil", "Allocate, scan, label and dispatch sales orders with a documented audit trail."],
];

export default function Home() {
  return <main className="landing-page min-h-screen overflow-hidden bg-[#f7f8f8] text-ink">
    <header className="landing-shell relative z-20 flex h-20 items-center justify-between gap-4">
      <Link href="/" className="group flex items-center gap-3" aria-label="ProConnect WMS home">
        <span className="landing-logo-grid" aria-hidden="true"><span /><span /><span /><span /></span>
        <span><strong className="block text-lg leading-none tracking-tight text-ink">ProConnect</strong><span className="mt-1 block text-[10px] font-bold tracking-[0.2em] text-rack">WAREHOUSE SYSTEMS</span></span>
      </Link>
      <nav className="hidden items-center gap-7 text-sm font-medium text-graphite lg:flex" aria-label="Primary navigation">
        <a href="#platform" className="transition hover:text-rack">Platform</a>
        <a href="#operations" className="transition hover:text-rack">Operations</a>
        <a href="#contact" className="transition hover:text-rack">Contact</a>
      </nav>
      <Link href="/login" className="landing-login"><span>Client login</span><ArrowRight size={16} /></Link>
    </header>

    <section className="landing-hero relative">
      <div className="landing-orb landing-orb-one" aria-hidden="true" />
      <div className="landing-orb landing-orb-two" aria-hidden="true" />
      <div className="landing-shell relative grid gap-12 py-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-24">
        <div className="max-w-2xl">
          <p className="landing-eyebrow"><span />WMS BUILT FOR MOVING BUSINESSES</p>
          <h1 className="mt-5 text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-ink sm:text-6xl lg:text-7xl">Clarity for every <em>move</em> in your warehouse.</h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-graphite">ProConnect WMS gives warehouse teams a single, reliable view of stock, locations, orders and exceptions — from receiving dock to final dispatch.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/login" className="landing-cta">Open your workspace <ArrowRight size={17} /></Link>
            <a href="#platform" className="landing-text-cta">Explore the platform <ArrowRight size={16} /></a>
          </div>
          <div className="mt-11 flex flex-wrap gap-x-8 gap-y-4 border-t border-ink/10 pt-6 text-sm text-graphite">
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-go" />Multi-organisation ready</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-go" />Bin-level traceability</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-go" />Role-based access</span>
          </div>
        </div>

        <div className="landing-dashboard-shadow relative mx-auto w-full max-w-[630px]">
          <div className="landing-dashboard">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#d7675f]" /><span className="h-2.5 w-2.5 rounded-full bg-[#e8b960]" /><span className="h-2.5 w-2.5 rounded-full bg-[#6baa85]" /></div><span className="text-xs font-medium text-slate-400">proconnectwms.com / dashboard</span>
            </div>
            <div className="grid min-h-[350px] grid-cols-[120px_1fr] sm:min-h-[420px] sm:grid-cols-[148px_1fr]">
              <aside className="bg-[#142a35] p-3 text-slate-300 sm:p-4"><div className="mb-7 flex items-center gap-2 text-xs font-bold text-white"><span className="h-5 w-5 rounded bg-amber" />PC WMS</div>{["Dashboard", "Inventory", "Locations", "Sales orders", "Purchase orders", "Reports"].map((item, index) => <div key={item} className={`mb-1 rounded px-2 py-2 text-[10px] sm:text-xs ${index === 0 ? "bg-white/10 text-white" : ""}`}>{item}</div>)}</aside>
              <div className="bg-[#f4f6f7] p-4 sm:p-6"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Operations overview</p><h2 className="mt-1 text-base font-semibold text-slate-800 sm:text-lg">Good morning, team</h2></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700">LIVE</span></div><div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">{[["1,248", "Available", "text-rack"], ["86", "To receive", "text-amber-dark"], ["31", "To ship", "text-alert"]].map(([value,label,color]) => <div key={label} className="rounded-lg bg-white p-3 shadow-sm"><p className={`text-base font-bold sm:text-xl ${color}`}>{value}</p><p className="mt-1 text-[9px] text-slate-400 sm:text-[10px]">{label}</p></div>)}</div><div className="mt-4 rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Order activity</p><p className="text-[10px] text-slate-400">This week</p></div><div className="mt-4 flex h-20 items-end justify-between gap-1.5 sm:gap-2">{[34,52,42,72,50,88,62,96,74,58,84,68].map((height,index) => <span key={index} style={{ height: `${height}%` }} className={`w-full rounded-t ${index === 7 ? "bg-amber" : "bg-rack/70"}`} />)}</div></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[10px] text-slate-400">PICKING QUEUE</p><p className="mt-1 text-sm font-semibold text-slate-700">SO-1048</p><div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-full w-3/4 rounded-full bg-rack" /></div></div><div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[10px] text-slate-400">INBOUND</p><p className="mt-1 text-sm font-semibold text-slate-700">PO-0271</p><p className="mt-2 text-[10px] font-medium text-go">Ready to receive</p></div></div></div>
            </div>
          </div>
          <div className="landing-floating-card absolute -bottom-5 -left-3 hidden items-center gap-3 rounded-xl bg-white p-3 shadow-xl sm:flex"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-light text-amber-dark"><Barcode size={21} /></span><span><strong className="block text-sm">Scan verified</strong><span className="text-xs text-graphite">SKU / serial matches order</span></span></div>
        </div>
      </div>
    </section>

    <section id="platform" className="landing-shell py-20 lg:py-28"><div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr]"><div><p className="landing-eyebrow"><span />ONE CONNECTED PLATFORM</p><h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">Designed around the way warehouse work actually happens.</h2></div><p className="max-w-xl self-end text-lg leading-8 text-graphite">Replace spreadsheets, disconnected scans and manual follow-ups with a focused operational system your team can use confidently on the warehouse floor.</p></div><div className="mt-12 grid gap-4 md:grid-cols-2">{capabilities.map(({ icon: Icon,title,text }, index) => <article key={title} className={`landing-capability ${index === 0 ? "md:col-span-2" : ""}`}><span className="landing-icon"><Icon size={22} /></span><div><h3 className="text-xl font-semibold tracking-tight">{title}</h3><p className="mt-2 max-w-md leading-7 text-graphite">{text}</p></div>{index === 0 && <div className="ml-auto hidden items-center gap-2 md:flex"><span className="h-2 w-2 rounded-full bg-go" /><span className="text-xs font-medium text-graphite">Always current</span></div>}</article>)}</div></section>

    <section id="operations" className="bg-[#142a35] py-20 text-white lg:py-28"><div className="landing-shell"><div className="flex flex-col justify-between gap-7 md:flex-row md:items-end"><div><p className="landing-eyebrow text-amber-light"><span className="bg-amber" />FROM DOCK TO DOOR</p><h2 className="mt-5 max-w-2xl text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">A disciplined flow for every unit you move.</h2></div><p className="max-w-sm leading-7 text-slate-300">The platform keeps every process connected, with the checks and context operators need at the moment of action.</p></div><div className="mt-14 grid gap-5 md:grid-cols-3">{workflow.map(([number,title,text]) => <article key={number} className="rounded-xl border border-white/15 p-6"><span className="font-mono text-sm text-amber">{number}</span><h3 className="mt-8 text-2xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-slate-300">{text}</p><div className="mt-7 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-amber"><ArrowRight size={18} /></div></article>)}</div></div></section>

    <section id="contact" className="landing-shell py-20 lg:py-28"><div className="landing-contact grid overflow-hidden rounded-2xl lg:grid-cols-[0.84fr_1.16fr]"><div className="p-8 sm:p-12"><p className="landing-eyebrow"><span />TALK TO OUR TEAM</p><h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">Let’s make your warehouse easier to run.</h2><p className="mt-6 max-w-md text-lg leading-8 text-graphite">Have a question about ProConnect WMS or need help from our operations team? Contact ProConnect Express Services directly.</p><div className="mt-9 flex flex-wrap gap-3"><a href="https://wa.me/601175054245" target="_blank" rel="noreferrer" className="landing-whatsapp"><MessageCircle size={18} />Chat on WhatsApp</a><a href="mailto:petersin@proconnect-express.com" className="landing-text-cta">Email us <ArrowRight size={16} /></a></div></div><div className="bg-rack p-8 text-white sm:p-12"><div className="grid gap-7 sm:grid-cols-2"><article className="landing-contact-item"><Phone size={22} className="text-amber-light" /><p className="landing-contact-label">Phone / WhatsApp</p><a href="tel:+601175054245" className="landing-contact-link">+60 11-7505 4245</a></article><article className="landing-contact-item"><Mail size={22} className="text-amber-light" /><p className="landing-contact-label">Email</p><a href="mailto:petersin@proconnect-express.com" className="landing-contact-link break-all">petersin@proconnect-express.com</a></article><article className="landing-contact-item"><MapPinned size={22} className="text-amber-light" /><p className="landing-contact-label">Office & Waze</p><p className="leading-6 text-white/80">58-1, Persiaran Mutiara 1,<br />Bandar Tasek Mutiara,<br />14120 Simpang Ampat, Pulau Pinang</p><a href="https://waze.com/ul?q=ProConnect%20Express%20Services" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-light hover:text-white">Open in Waze <ExternalLink size={14} /></a></article><article className="landing-contact-item"><Clock3 size={22} className="text-amber-light" /><p className="landing-contact-label">Operating hours</p><p className="leading-7 text-white/80">Monday – Friday<br /><strong className="font-medium text-white">10.00am – 6.00pm</strong></p><p className="mt-2 leading-7 text-white/80">Saturday<br /><strong className="font-medium text-white">10.00am – 3.00pm</strong></p></article></div></div></div></section>

    <footer className="border-t border-ink/10 bg-white"><div className="landing-shell grid gap-8 py-9 text-sm text-graphite lg:grid-cols-[1fr_auto_1fr] lg:items-center"><div className="flex items-center gap-2 font-medium text-ink"><PackageCheck size={18} className="text-rack" />ProConnect WMS</div><p className="text-center text-xs leading-6">© 2026 Proconnect Express Services (JM0993273-A). All rights reserved.</p><div className="flex flex-wrap justify-start gap-x-5 gap-y-2 lg:justify-end"><a href="https://www.proconnect-express.com/home" target="_blank" rel="noreferrer" className="font-medium text-rack hover:underline">ProConnect Express Services <ExternalLink className="ml-1 inline-block" size={13} /></a><span className="text-xs">Designed &amp; hosted by <span className="font-semibold text-ink">ProNexa Technology</span></span><Link href="/login" className="font-medium text-rack hover:underline">Client login</Link></div></div></footer>
  </main>;
}
