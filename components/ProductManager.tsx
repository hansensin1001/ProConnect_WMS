"use client";
import { FormEvent, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
export function ProductManager({ orgId, canManage }: { orgId: string; canManage: boolean }) {
 const supabase=useMemo(()=>createClient(),[]);const[open,setOpen]=useState(false);const[msg,setMsg]=useState("");if(!canManage)return null;
 async function add(event:FormEvent<HTMLFormElement>){event.preventDefault();try{const f=new FormData(event.currentTarget);const{error}=await(supabase.from("products")as any).insert({org_id:orgId,barcode:f.get("barcode"),name:f.get("name"),unit_of_measure:f.get("uom")||"PCS"});if(error)throw error;setMsg("SKU created. Its SKU# identifier was assigned automatically.");event.currentTarget.reset();}catch(error){setMsg(error instanceof Error?error.message:"Unable to create SKU.");}}
 return <><div className="flex justify-end"><button onClick={()=>setOpen(true)} className="btn-primary"><Plus size={16}/>Add SKU</button></div><Drawer open={open} onClose={()=>setOpen(false)} title="Add SKU" description="A short SKU# identifier is generated automatically"><form onSubmit={add} className="space-y-4"><label className="block text-sm">Product name<input name="name" required className="input-field mt-1"/></label><label className="block text-sm">Barcode<input name="barcode" required className="input-field mt-1 code-label"/></label><label className="block text-sm">Unit of measure<input name="uom" defaultValue="PCS" className="input-field mt-1"/></label>{msg&&<p className="text-sm text-graphite">{msg}</p>}<div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" onClick={()=>setOpen(false)} className="btn-secondary">Cancel</button><button className="btn-primary">Create SKU</button></div></form></Drawer></>;
}
