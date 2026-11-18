"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Leaf, Ship, Package, FlaskConical, QrCode, CreditCard, Truck, LogIn, UserPlus, Calculator, Gift, ArrowRight, Boxes, BadgeCheck, FileSignature } from "lucide-react";
import { api } from "@/lib/api";
import { num, date, money, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button, Input, Field, Select, Notice, StatusBadge, Badge, Textarea } from "@/components/ui";
import { useToast } from "@/components/providers";
import { usePortal } from "@/components/PortalContext";
import { ShipMap } from "@/components/ShipMap";

const T = {
  es: { hero: "Páprika peruana premium, trazable del campo a su almacén", sub: "Frascos de 4 oz listos para el anaquel de EE. UU. Pague con tarjeta, Yape o transferencia; su dinero queda protegido por un contrato inteligente que solo libera el pago cuando la calidad y la entrega están verificadas.", buy: "Comprar ahora", login: "Ingresar", register: "Crear cuenta de comprador", avail: "Disponible ahora", perPallet: "por paleta", quote: "Cotizador instantáneo", order: "Hacer pedido", orders: "Mis pedidos", samples: "Solicitar muestras" },
  en: { hero: "Premium Peruvian paprika, traceable from farm to your warehouse", sub: "4 oz jars ready for US shelves. Pay by card, Yape or bank transfer; your money is protected by a smart contract that only releases payment once quality and delivery are verified.", buy: "Buy now", login: "Sign in", register: "Create buyer account", avail: "Available now", perPallet: "per pallet", quote: "Instant quote", order: "Place order", orders: "My orders", samples: "Request samples" },
};

export default function PortalHome() {
  const { me, lang } = usePortal();
  const t = T[lang];
  const [cat, setCat] = React.useState<any>(null);
  const [data, setData] = React.useState<any>(null);
  const isBuyer = me && ["COMPRADOR", "BROKER"].includes(me.role);
  React.useEffect(() => { api("/public/catalog").then(setCat).catch(() => {}); }, []);
  const load = React.useCallback(() => { if (isBuyer) api("/portal/me").then(setData).catch(() => {}); }, [isBuyer]);
  React.useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[26px] bg-[radial-gradient(circle_at_85%_20%,rgba(165,42,42,.65),transparent_50%),linear-gradient(135deg,#1C3F2B_0%,#12291C_100%)] px-6 py-10 text-white sm:px-12 sm:py-14">
        <svg viewBox="0 0 150 80" className="pointer-events-none absolute -right-6 bottom-6 hidden w-[420px] opacity-90 lg:block" aria-hidden>
          <g fill="#A52A2A"><path d="M20 30c-12 4-16 20-8 34 6 10 22 12 32 4C30 62 26 44 20 30z" /><path d="M70 22c-14 2-22 18-16 34 4 12 20 18 32 10C72 58 70 40 70 22z" fill="#8C2121" /><path d="M118 28c-12 4-16 20-8 34 6 10 22 12 32 4-14-6-18-24-24-38z" /></g>
          <g stroke="#2F6B45" strokeWidth="4" strokeLinecap="round" fill="none"><path d="M20 30c2-8 8-12 14-12" /><path d="M70 22c2-8 8-12 14-12" /><path d="M118 28c2-8 8-12 14-12" /></g>
        </svg>
        <span className="text-[11px] font-bold uppercase tracking-[.26em] text-[#F2C9C0]">Don Pimentón · Caravelí, Arequipa · Product of Peru</span>
        <h1 className="mt-3 max-w-[22ch] font-display text-[clamp(30px,4.4vw,52px)] leading-[1.06]">{t.hero}</h1>
        <p className="mt-4 max-w-2xl text-[15.5px] text-white/85">{t.sub}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href="#comprar" className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-4 font-extrabold text-forest shadow-xl hover:bg-paprika-50">{t.buy}<ArrowRight className="h-5 w-5 text-paprika" /></a>
          {cat && <span className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-5 py-4 text-sm font-bold"><Boxes className="h-5 w-5 text-gold" />{t.avail}: {cat.availablePallets} {lang === "en" ? (cat.availablePallets === 1 ? "pallet" : "pallets") : (cat.availablePallets === 1 ? "paleta" : "paletas")} · {num(cat.availableJars)} {lang === "en" ? "jars" : "frascos"}</span>}
        </div>
        <div className="mt-8 grid max-w-3xl grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[[ShieldCheck, lang === "en" ? "Smart-contract escrow" : "Pago en custodia"], [QrCode, lang === "en" ? "QR origin story" : "QR de origen"], [FlaskConical, lang === "en" ? "Lab COA per lot" : "COA por lote"], [Ship, lang === "en" ? "Live shipment map" : "Mapa del envío en vivo"]].map(([I, l]: any) => <div key={l} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2"><I className="h-4 w-4 text-gold" />{l}</div>)}
        </div>
      </section>
      {cat && <Catalog cat={cat} lang={lang} />}
      <div id="comprar" />
      {isBuyer ? (data ? <BuyerArea data={data} cat={cat} reload={load} lang={lang} /> : null) : <AuthArea lang={lang} />}
    </div>
  );
}

function Catalog({ cat, lang }: { cat: any; lang: "es" | "en" }) {
  const t = T[lang];
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="overflow-hidden">
        <div className="grid sm:grid-cols-[200px_1fr]">
          <div className="flex items-center justify-center bg-[linear-gradient(135deg,#F7E4E1,#F3E9D8)] p-6">
            <svg viewBox="0 0 120 170" className="h-44" aria-label="Frasco de páprika 4 oz"><rect x="30" y="8" width="60" height="22" rx="4" fill="#1C3F2B" /><rect x="34" y="12" width="52" height="4" fill="#2F6B45" /><path d="M24 34h72v118a10 10 0 0 1-10 10H34a10 10 0 0 1-10-10z" fill="#fff" opacity=".85" stroke="#d1c7b8" /><path d="M28 70h64v80a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8z" fill="#A52A2A" /><rect x="28" y="62" width="64" height="48" fill="#F8F5EF" stroke="#D9A441" /><text x="60" y="80" textAnchor="middle" fontSize="9" fontWeight="800" fill="#1C3F2B">DON PIMENTÓN</text><text x="60" y="92" textAnchor="middle" fontSize="7" fill="#A52A2A">Premium Ground Paprika</text><text x="60" y="104" textAnchor="middle" fontSize="6" fill="#6B7280">NET WT 4 oz (113 g)</text></svg>
          </div>
          <div className="p-5">
            <Badge tone="green">{cat.product.origin}</Badge>
            <h2 className="mt-2 text-xl font-extrabold">{cat.product.name}</h2>
            <p className="text-sm text-muted">{cat.product.jar} · {cat.product.net} · {lang === "en" ? "shelf life" : "vida útil"} {cat.product.shelfLife}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-soft p-2.5"><p className="text-[11px] text-muted">{lang === "en" ? "Price per jar (FCA)" : "Precio por frasco (FCA)"}</p><b className="text-lg">US$ {cat.priceUsdPerJar.toFixed(2)}</b></div>
              <div className="rounded-xl bg-soft p-2.5"><p className="text-[11px] text-muted">{t.perPallet}</p><b className="text-lg">US$ {num(cat.priceUsdPerJar * cat.packaging.jarsPerPallet)}</b></div>
              <div className="rounded-xl bg-soft p-2.5"><p className="text-[11px] text-muted">{lang === "en" ? "Pallet" : "Paleta"}</p><b>{cat.packaging.casesPerPallet} × {cat.packaging.jarsPerCase} = {num(cat.packaging.jarsPerPallet)}</b></div>
              <div className="rounded-xl bg-soft p-2.5"><p className="text-[11px] text-muted">{lang === "en" ? "Net / gross" : "Neto / bruto"}</p><b>{Number(cat.packaging.netKgPerPallet).toFixed(1)} / {Number(cat.packaging.grossKgPerPallet).toFixed(0)} kg</b></div>
            </div>
            <p className="mt-3 text-xs text-muted">HTS {cat.product.hts} · GTIN {cat.product.gtin.gtin13} · {cat.incoterms.join(" / ")} {cat.incotermVersion} · {cat.originPort} → {cat.destinationPort} (~{cat.transitDays} {lang === "en" ? "days" : "días"}) · {cat.priceNote}</p>
          </div>
        </div>
      </Card>
      <Card><CardHeader title={lang === "en" ? "Quality specification & compliance" : "Especificación de calidad y cumplimiento"} icon={<BadgeCheck className="h-5 w-5" />} />
        <CardBody className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <span>Color: <b>{cat.specs.astaMin}–{cat.specs.astaMax} ASTA</b></span><span>{lang === "en" ? "Moisture" : "Humedad"}: <b>≤ {cat.specs.moistureMax} %</b></span>
            <span>aw: <b>≤ {cat.specs.awMax}</b></span><span>Salmonella: <b>{lang === "en" ? "absent/25 g" : "ausente/25 g"}</b></span>
            <span>Aflatoxin B1: <b>≤ {cat.specs.aflatoxinB1Max} µg/kg</b></span><span>{lang === "en" ? "Total aflatoxins" : "Aflatoxinas totales"}: <b>≤ {cat.specs.aflatoxinTotalMax} µg/kg</b></span>
          </div>
          <div className="space-y-1 border-t border-line pt-2">{cat.certifications.slice(0, 7).map((c: any) => <div key={c.name} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{c.name}</span><StatusBadge status={c.status} /></div>)}</div>
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-2 text-xs"><span className="font-bold">{lang === "en" ? "Payment:" : "Pago:"}</span><Badge tone={cat.payments.card ? "green" : "slate"}><CreditCard className="h-3 w-3" />{lang === "en" ? "Card" : "Tarjeta"}</Badge><Badge tone={cat.payments.yape ? "green" : "slate"}>Yape</Badge><Badge tone={cat.payments.transfer ? "green" : "slate"}>{lang === "en" ? "Bank transfer" : "Transferencia"}</Badge><Badge tone="blue"><FileSignature className="h-3 w-3" />Smart contract escrow</Badge></div>
        </CardBody></Card>
    </div>
  );
}

function AuthArea({ lang }: { lang: "es" | "en" }) {
  const t = T[lang];
  const toast = useToast();
  const { reload } = usePortal();
  const [email, setEmail] = React.useState("compras@importadordemo-usa.com");
  const [password, setPassword] = React.useState("");
  const [reg, setReg] = React.useState<any>({ company: "", taxId: "", country: "Estados Unidos", city: "", contact: "", email: "", password: "", acceptTerms: false });
  const [busy, setBusy] = React.useState(false);
  const login = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { await api("/auth/login", { body: { email, password } }); reload(); } catch (err: any) { toast.error(t.login, err.message); } finally { setBusy(false); } };
  const register = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { const r = await api<any>("/public/register", { body: reg }); toast.success(r.message); setEmail(reg.email); setPassword(reg.password); } catch (err: any) { toast.error(t.register, err.message); } finally { setBusy(false); } };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader title={t.login} subtitle={lang === "en" ? "Demo buyer: compras@importadordemo-usa.com · broker: broker@foodbroker-demo.com" : "Comprador demo: compras@importadordemo-usa.com · broker: broker@foodbroker-demo.com"} icon={<LogIn className="h-5 w-5" />} />
        <CardBody><form onSubmit={login} className="space-y-3"><Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field><Field label={lang === "en" ? "Password" : "Contraseña"}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="DonPimenton#2026 (demo)" /></Field><Button type="submit" loading={busy} className="w-full">{t.login}</Button></form></CardBody></Card>
      <Card><CardHeader title={t.register} subtitle={lang === "en" ? "Importers and distributors. Account linked to the ERP and the smart contract." : "Importadores y distribuidores. Cuenta vinculada al ERP y al smart contract."} icon={<UserPlus className="h-5 w-5" />} />
        <CardBody><form onSubmit={register} className="grid grid-cols-2 gap-3">
          {[["company", lang === "en" ? "Company" : "Empresa"], ["taxId", "Tax ID / EIN"], ["country", lang === "en" ? "Country" : "País"], ["city", lang === "en" ? "City" : "Ciudad"], ["contact", lang === "en" ? "Contact name" : "Contacto"], ["email", "Email"]].map(([k, l]) => <Field key={k} label={l}><Input value={reg[k]} type={k === "email" ? "email" : "text"} onChange={(e) => setReg({ ...reg, [k]: e.target.value })} required={k !== "city"} /></Field>)}
          <Field label={lang === "en" ? "Password (10+, 1 uppercase, 1 number)" : "Contraseña (10+, 1 mayúscula, 1 número)"} className="col-span-2"><Input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required /></Field>
          <label className="col-span-2 flex items-start gap-2 text-xs text-muted"><input type="checkbox" checked={reg.acceptTerms} onChange={(e) => setReg({ ...reg, acceptTerms: e.target.checked })} />{lang === "en" ? "I accept the terms and the processing of my data under Peruvian Law 29733 (demo)." : "Acepto los términos y el tratamiento de mis datos según la Ley N.° 29733 (demo)."}</label>
          <Button type="submit" loading={busy} className="col-span-2" variant="secondary">{t.register}</Button>
        </form></CardBody></Card>
    </div>
  );
}

function BuyerArea({ data, cat, reload, lang }: { data: any; cat: any; reload: () => void; lang: "es" | "en" }) {
  const t = T[lang];
  const toast = useToast();
  const router = useRouter();
  const [pallets, setPallets] = React.useState(1);
  const [incoterm, setIncoterm] = React.useState("FCA");
  const [delivery, setDelivery] = React.useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [addr, setAddr] = React.useState("");
  const live = data.orders.find((o: any) => ["EN_TRANSITO", "ARRIBADO", "ENTREGADO"].includes(o.status));
  const price = cat?.priceUsdPerJar ?? 2;
  const jars = pallets * (cat?.packaging.jarsPerPallet ?? 2304);
  const order = async () => { setBusy(true); try { const s = await api<any>("/portal/orders", { body: { pallets, incoterm, deliveryDate: delivery, notes } }); toast.success(lang === "en" ? `Order ${s.code} placed` : `Pedido ${s.code} registrado`, lang === "en" ? "The ERP validates quality, reserves stock and creates the smart contract automatically" : "El ERP valida calidad, reserva stock y crea el smart contract automáticamente"); router.push(`/portal/pedidos/${s.code}`); } catch (e: any) { toast.error(t.order, e.message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <Card><CardBody className="flex flex-wrap items-center gap-4"><div><p className="text-xs text-muted">{lang === "en" ? "Account" : "Cuenta"}</p><b className="text-lg">{data.customer.name}</b><p className="text-xs text-muted">{data.customer.city} · {data.customer.country} · {data.customer.importerNumber ?? ""}</p></div>{data.readOnly && <Badge tone="blue">{lang === "en" ? "Broker · read-only" : "Broker · solo consulta"}</Badge>}<p className="ml-auto max-w-md text-xs text-muted">{data.customer.fsvp}</p></CardBody></Card>
      {live && <Link href={`/portal/pedidos/${live.code}`}><ShipMap status={live.status} progress={live.voyageProgress} vessel={live.vessel} code={live.code} height={360} /></Link>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {!data.readOnly && <Card><CardHeader title={`${t.quote} · ${t.order}`} icon={<Calculator className="h-5 w-5" />} />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={lang === "en" ? "Pallets" : "Paletas"}><Input type="number" min={1} max={20} value={pallets} onChange={(e) => setPallets(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></Field>
              <Field label="Incoterm"><Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}><option value="FCA">FCA Callao</option><option value="FOB">FOB Callao</option></Select></Field>
              <Field label={lang === "en" ? "Requested delivery" : "Entrega solicitada"} className="col-span-2"><Input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
            </div>
            <div className="rounded-xl bg-soft p-3 text-sm">
              <p>{pallets} × ({cat?.packaging.casesPerPallet ?? 96} {lang === "en" ? "cases" : "cajas"} × {cat?.packaging.jarsPerCase ?? 24}) = <b>{num(jars)} {lang === "en" ? "jars" : "frascos"}</b> · {(jars * 0.113).toFixed(3)} kg {lang === "en" ? "net" : "netos"}</p>
              <p className="mt-1 text-2xl font-extrabold">US$ {num(jars * price, 2)}</p>
              <p className="text-xs text-muted">{lang === "en" ? "Reference test price; final price on the pro-forma invoice." : "Precio de referencia de prueba; el precio final figura en la proforma."}</p>
              {cat && pallets > cat.availablePallets && <p className="mt-1 text-xs font-semibold text-amberx">{lang === "en" ? `Only ${cat.availablePallets} pallet(s) in stock: the rest will be produced (lead time ~45 days).` : `Solo hay ${cat.availablePallets} paleta(s) en stock: el resto se producirá (≈ 45 días).`}</p>}
            </div>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={lang === "en" ? "Notes (port, label, broker…)" : "Notas (puerto, etiqueta, broker…)"} />
            <Button className="w-full" size="lg" loading={busy} onClick={order}><Package className="h-5 w-5" />{t.order}</Button>
          </CardBody></Card>}
        <Card className={data.readOnly ? "lg:col-span-2" : ""}><CardHeader title={t.orders} subtitle={lang === "en" ? "Live status from the ERP and the smart contract" : "Estado en vivo desde el ERP y el smart contract"} icon={<Truck className="h-5 w-5" />} />
          <CardBody className="space-y-2">
            {data.orders.length === 0 && <p className="text-sm text-muted">{lang === "en" ? "No orders yet." : "Aún no tiene pedidos."}</p>}
            {data.orders.map((o: any) => (
              <Link key={o.code} href={`/portal/pedidos/${o.code}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 hover:border-agro">
                <div className="min-w-0 flex-1"><b>{o.code}</b><p className="text-xs text-muted">{o.pallets} pal · {num(o.jars)} {lang === "en" ? "jars" : "frascos"} · US$ {num(o.amountUsd, 2)} · {lang === "en" ? "paid" : "pagado"} US$ {num(o.paidUsd, 2)} · {lang === "en" ? "delivery" : "entrega"} {date(o.deliveryDate)}</p>
                  {["EN_TRANSITO", "ARRIBADO", "ENTREGADO", "CERRADO"].includes(o.status) && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full bg-gold" style={{ width: `${Math.round(o.voyageProgress * 100)}%` }} /></div>}</div>
                {o.agreement && <StatusBadge status={o.agreement.status} label={`SC ${o.agreement.status}`} />}<StatusBadge status={o.status} /><ArrowRight className="h-4 w-4 text-muted" />
              </Link>
            ))}
          </CardBody></Card>
      </div>
      {!data.readOnly && <Card><CardHeader title={t.samples} subtitle={lang === "en" ? "A sample box (6 jars) with the lot COA" : "Caja de muestras (6 frascos) con el COA del lote"} icon={<Gift className="h-5 w-5" />} />
        <CardBody className="flex flex-wrap gap-2"><Input className="min-w-[280px] flex-1" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={lang === "en" ? "Shipping address" : "Dirección de envío"} /><Button variant="outline" onClick={async () => { try { const r = await api<any>("/portal/samples", { body: { address: addr } }); toast.success(r.message); setAddr(""); } catch (e: any) { toast.error(t.samples, e.message); } }}>{t.samples}</Button></CardBody></Card>}
    </div>
  );
}
