import {it,expect} from 'vitest';
import {eldoradoClient} from '@/domains/eldorado/client';
import {normalizeOrder} from '@/domains/orders/service';
import {readSellerOfferPage} from '@/domains/offers/service';
const enabled=process.env.RIVOX_LIVE_READS==='true';
it.skipIf(!enabled)('validates authorized real order reads and normalization without upstream mutations',async()=>{
 const page=await eldoradoClient().orders();
 for(const order of page.results){const normalized=normalizeOrder(order);expect(normalized.id).toBe(order.id);expect(typeof normalized.product_title).toBe('string');}
 console.log('Live authorized order read: '+page.results.length+' records; no upstream writes.');
},60000);
it.skipIf(!enabled)('validates official flexible, predefined, and item offer read contracts',async()=>{
 for(const source of ['flexible','predefined','items'] as const){const result=await readSellerOfferPage(source);expect(Array.isArray(result.items)).toBe(true);console.log('Live authorized '+source+' listing read: '+result.items.length+' records; no upstream writes.');}
},60000);
