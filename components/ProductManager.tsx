"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
export function ProductManager({orgId,canManage}:{orgId:string;canManage:boolean}){
 const supabase=createClient();const[msg,setMsg]=useState("");
 if(!canManage)return <div className="border border-line bg-panel px-4 py-3 text-sm text-graphite">Inventory is organization-scoped. Operators can view stock and use scanning; managers and owners can maintain SKU records.</div>;
 async function add(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const{error}=await(supabase.from("products")as any).insert({org_id:orgId,sku:f.get("sku"),barcode:f.get("barcode"),name:f.get("name"),unit_of_measure:f.get("uom")||"PCS"});if(error)return setMsg(error.message);setMsg("SKU created. Refresh Inventory to see it in the stock table.");e.currentTarget.reset();}
 return <form onSubmit={add} className="border border-line bg-panel p-4"><div className="mb-3 text-sm font-medium">Create SKU</div><div className="grid gap-2 sm:grid-cols-5"><input name="sku" required placeholder="SKU" className="border border-line bg-paper px-3 py-2 text-sm code-label"/><input name="barcode" required placeholder="Barcode" className="border border-line bg-paper px-3 py-2 text-sm code-label"/><input name="name" required placeholder="Product name" className="border border-line bg-paper px-3 py-2 text-sm"/><input name="uom" defaultValue="PCS" placeholder="UOM" className="border border-line bg-paper px-3 py-2 text-sm"/><button className="bg-ink px-3 py-2 text-sm text-white">Add SKU</button></div>{msg&&<p className="mt-2 text-sm text-graphite">{msg}</p>}</form>;
}
