import {assertEquals,assert} from "jsr:@std/assert@1";
import {parseTelegramPage,classify} from "./telegram_parser.ts";
Deno.test("telegram parser extracts post",()=>{const h='<div class="tgme_widget_message" data-post="demo/123"><div class="tgme_widget_message_text js-message_text" dir="auto">2 Шахеда<br>курс на місто</div><time datetime="2026-09-24T22:30:00+00:00"></time></div>';const x=parseTelegramPage(h,"@demo");assertEquals(x.length,1);assertEquals(x[0].message_id,123);assert(x[0].text.includes("2 Шахеда"));assertEquals(classify(x[0].text),"uav")});
Deno.test("classification distinguishes missile and KAB",()=>{assertEquals(classify("Ракета курсом на південь"),"missile");assertEquals(classify("2 КАБ на область"),"kab")});
