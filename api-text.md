`POST https://ark.cn-beijing.volces.com/api/v3/chat/completions`   [运行](https://api.volcengine.com/api-explorer/?action=ChatCompletions&groupName=%E5%AF%B9%E8%AF%9D%28Chat%29%20API&serviceCode=ark&version=2024-01-01)
发送包含文本、图片、视频等模态的消息列表，模型将生成对话中的下一条消息。

Tips：一键展开折叠，快速检索内容
:::tip
打开页面右上角开关后，**ctrl ** + f 可检索页面内所有内容。
<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_952f1a5ff1c9fc29c4642af62ee3d3ee.png) </span>

:::

```mixin-react
return (<Tabs>
<Tabs.TabPane title="在线调试" key="NxI2ZZeLhf"><RenderMd content={`<APILink link="https://api.volcengine.com/api-explorer/?action=ChatCompletions&groupName=%E5%AF%B9%E8%AF%9D%28Chat%29%20API&serviceCode=ark&version=2024-01-01" description="API Explorer 您可以通过 API Explorer 在线发起调用，无需关注签名生成过程，快速获取调用结果。"></APILink>
`}></RenderMd></Tabs.TabPane>
<Tabs.TabPane title="快速入口" key="cyg8mBFqXQ"><RenderMd content={` [ ](#)[体验中心](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/chat)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2abecd05ca2779567c6d32f0ddc7874d.png =20x) </span>[模型列表](https://www.volcengine.com/docs/82379/1330310)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_a5fdd3028d35cc512a10bd71b982b6eb.png =20x) </span>[模型计费](https://www.volcengine.com/docs/82379/1544106)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_afbcf38bdec05c05089d5de5c3fd8fc8.png =20x) </span>[API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D)
 <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_bef4bc3de3535ee19d0c5d6c37b0ffdd.png =20x) </span>[开通模型](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_57d0bca8e0d122ab1191b40101b5df75.png =20x) </span>[文本生成](https://www.volcengine.com/docs/82379/1399009)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_57d0bca8e0d122ab1191b40101b5df75.png =20x) </span>[视觉理解](https://www.volcengine.com/docs/82379/1362931)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_f45b5cd5863d1eed3bc3c81b9af54407.png =20x) </span>[接口文档](https://www.volcengine.com/docs/82379/1494384)
`}></RenderMd></Tabs.TabPane></Tabs>);
```


---


<span id="RxN8G2nH"></span>
## 请求参数
> 跳转 [响应参数](#Qu59cel0)

<span id="pjuiBZGA"></span>
### 请求体

---


**model** `string` `必选`
调用的模型 ID （Model ID），[开通模型服务](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)，并[查询 Model ID](https://www.volcengine.com/docs/82379/1330310) 。
多个应用及精细管理场景，推荐使用 Endpoint ID 调用。详细请参考 [获取 Endpoint ID](https://www.volcengine.com/docs/82379/1099522)。

---


**messages**  `object[]` `必选`
消息列表，不同模型支持不同类型的消息，如文本、图片、视频等。

消息类型

---


系统消息 `object`
模型需遵循的指令，包括扮演的角色、背景信息等。

属性

---


messages.**role** `string` `必选`
发送消息的角色，此处应为`system`。

---


messages.**content** `string / object[]` `必选`
系统消息的内容。

属性

---


纯文本内容 `string`
纯文本消息内容。

---


多模态内容 `object[]` 

各模态内容对象

---


文本部分 `object`

属性

---


messages.content.**text ** `string` `必选`
文本模态部分的内容。

---


messages.content.**type ** `string` `必选`
内容模态，此处应为 `text`。


---


图片部分 `object`

属性

---


messages.content.**image_url ** `object` `必选`
图片模态的内容。

属性

---


messages.content.image_url.**url ** `string` `必选`
支持格式如下，详细信息请参见[使用说明](https://www.volcengine.com/docs/82379/1362931#.5L2_55So6K-05piO)。

* 图片链接
* 图片的Base64编码


---


messages.content.image_url.**detail ** `string`  
取值范围：`low`、`high`、`xhigh`。
理解图片的精细度、不同模型默认取值及对应的具体像素区间，参见[控制图片理解的精细度](https://www.volcengine.com/docs/82379/1362931#bf4d9224)。


---


messages.content.**type ** `string` `必选`
内容模态，此处应为 `image_url`。


---


视频部分 `object`
> 不支持理解视频中的音频内容。


属性

---


messages.content.**type ** `string` `必选`
内容模态，此处应为`video_url`。

---


messages.content.**video_url**`object` `必选`
视频消息的内容部分。

属性

---


messages.content.video_url.**url ** `string` `必选`
支持格式如下，具体使用请参见[视频理解说明](https://www.volcengine.com/docs/82379/1895586)。

* 视频链接
* 视频的Base64编码


---


messages.content.video_url.**fps** `float/ null` `默认值 1`
取值范围：`[0.2, 5]`
抽帧频率，详见[视频理解](https://www.volcengine.com/docs/82379/1895586)。

* 取值越高，对视频中画面变化越敏感。
* 取值越低，对视频中画面变化越迟钝，但 token 花费少，速度更快。






---


用户消息 `object` 
用户角色发送的消息。不同模型支持的字段类型不同。

属性

---


messages.**role** `string` `必选`
发送消息的角色，此处应为`user`。

---


messages.**content** `string / object[]` `必选`
用户信息内容。

内容类型

---


纯文本内容 `string`
纯文本消息内容。

---


多模态内容 `object[]` 
支持文本、图片、视频等模态内容。

内容类型

---


文本部分 `object`
多模态消息中，文本模态的部分。

属性

---


messages.content.**text ** `string` `必选`
文本模态部分的内容。

---


messages.content.**type ** `string` `必选`
内容模态，此处应为 `text`。


---


图片部分 `object`

属性

---


messages.content.**type ** `string` `必选`
消息模态，此处应为 `image_url`。

---


messages.content.**image_url ** `object` `必选`
图片模态的内容。

属性

---


messages.content.image_url.**url ** `string` `必选`
支持格式如下，具体请参见[使用说明](https://www.volcengine.com/docs/82379/1362931#.5L2_55So6K-05piO)。

* 图片链接
* 图片的Base64编码


---


messages.content.image_url.**detail ** `string / null`  
取值范围：`low`、`high`、`xhigh`。
理解图片的精细度、不同模型默认取值及对应的具体像素区间，参见[控制图片理解的精细度](https://www.volcengine.com/docs/82379/1362931#bf4d9224)。

---


messages.content.image_url.**image_pixel_limit  ** `object / null` `默认值 null`
输入给模型的图片的像素范围，如不在此范围，图片会被等比例缩放至该范围。
:::warning
图片像素范围需在 [196, 36,000,000]，否则会直接报错。

:::
* 生效优先级：高于 **detail ** 字段，即同时配置 **detail ** 与 **image_pixel_limit ** 字段时，生效 **image_pixel_limit ** 字段配置 **。** 
* 默认生效规则：若未设置**image_pixel_limit**，则使用 **detail ** 配置的值对应的 **min_pixels ** / **max_pixels ** 值。


---



* messages.content.image_url.image_pixel_limit.**max_pixels ** `integer`
   传入图片最大像素限制，大于此像素则等比例缩小至 **max_pixels ** 字段取值以下。若未设置，则取值为 **detail ** 配置的值对应的 **max_pixels ** 值。
   * doubao\-seed\-1.8 之前的模型取值范围：(**min_pixels**,  `4014080`]
   * doubao\-seed\-1.8、doubao\-seed\-2.0 模型的取值范围：(**min_pixels**, `9031680`]。


---



* messages.content.image_url.image_pixel_limit.**min_pixels ** `integer`
   传入图片最小像素限制，小于此像素则等比例放大至 **min_pixels ** 字段取值以上。若未设置，则取值为 **detail ** 配置的值对应的 **min_pixels ** 值。
   * doubao\-seed\-1.8 之前的模型取值范围：[`3136`,  **max_pixels**)
   * doubao\-seed\-1.8、doubao\-seed\-2.0 模型的取值范围：[`1764`,  **max_pixels**)



---


视频部分 `object`
> 不支持理解视频中的音频内容。


属性

---


messages.content.**type ** `string` `必选`
内容模态，此处应为 `video_url` **。** 

---


messages.content.**video_url**`object` `必选`
视频模态的内容。

属性

---


messages.content.video_url.**url ** `string` `必选`
支持格式如下，具体使用请参见[视频理解说明](https://www.volcengine.com/docs/82379/1895586)。

* 视频链接
* 视频的Base64编码


---


messages.content.video_url.**fps** `float/ null` `默认值 1`
取值范围：`[0.2, 5]`。
抽帧频率，详见[视频理解](https://www.volcengine.com/docs/82379/1895586)。

* 取值越高，对视频中画面变化越敏感。
* 取值越低，对视频中画面变化越迟钝，但 token 花费少，速度更快。






---


模型消息 `object`
历史对话中，模型角色返回的消息。用以保持对话一致性，多在[多轮对话](https://www.volcengine.com/docs/82379/1399009#.5aSa6L2u5a-56K-d)及[续写模式](https://www.volcengine.com/docs/82379/1359497)使用。

属性
:::tip
messages.**content** ** ** 与 messages.**tool_calls** ** ** 至少填写其一。

:::
---


messages.**role** `string` `必选`
发送消息的角色，此处应为`assistant`。

---


messages.**content** `string / array`  
模型消息的内容。

---


messages.**reasoning_content** `string`
模型消息中思维链内容。
> 仅模型 `doubao-seed-1.8`、`deepseek-v3.2`、`doubao-seed-2.0`支持该字段。


---


messages.**tool_calls** `object[]`
模型消息中工具调用部分。

属性

---


messages.tool_calls **.function ** `object` `必选`
模型返回的需调用的函数信息。

属性

---


messages.tool_calls **.** function.**name ** `string` `必选`
需调用的函数的名称。

---


messages.tool_calls **.** function.**arguments ** `string` `必选`
需调用的函数的入参，JSON 格式。
:::tip
模型并不总是生成有效的 JSON，可能会虚构出未定义的参数。建议在调用函数前，验证参数是否有效。

:::

---


messages.tool_calls **.id ** `string` `必选`
需调用的工具的 ID，由模型生成。

---


messages.tool_calls **.type ** `string` `必选`
消息类型，当前仅支持`function`。



---


工具消息 `object`
历史对话中，调用工具返回的消息。工具调用场景中使用。

属性

---


messages.**role** `string` `必选`
发送消息的角色，此处应为`tool`。

---


messages.**content** `string / array`  `必选`
工具返回的消息。

---


messages.**tool_call_id ** `string` `必选`
模型生成的需调用工具请求时，生成的ID。在程序调用工具的返回需要附上同一 ID，来关联工具结构与模型请求。避免多工具调用时混淆信息。



---


**thinking** `object` `默认值 {"type":"enabled"}`
控制模型是否开启深度思考模式。
> 不同模型是否支持以及默认取值不同，详情请查询[文档](https://www.volcengine.com/docs/82379/1449737#0002)。


属性

---


thinking.**type ** `string`  `必选`
取值范围：`enabled`， `disabled`，`auto`。

* `enabled`：开启思考模式，模型强制先思考再回答。
* `disabled`：关闭思考模式，模型直接回答问题，不进行思考。
* `auto`：自动思考模式，模型根据问题自主判断是否需要思考，简单题目直接回答。


---


**stream** `boolean / null` `默认值 false`
响应内容是否流式返回：

* `false`：模型生成完所有内容后一次性返回结果。
* `true`：按 SSE 协议逐块返回模型生成内容，并以一条 `data: [DONE] `消息结束。当 **stream** 为 `true` 时，可设置 **stream_options** 字段以获取 token 用量统计信息。


---


**stream_options** `object / null` `默认值 null`
流式响应的选项。当 **stream** 为 `true` 时，可设置 **stream_options** 字段。

属性

---


stream_options.**include_usage ** `boolean / null` `默认值 false`
模型流式输出时，是否在输出结束前输出本次请求的 token 用量信息。

* `true`：在 `data: [DONE]` 消息之前会返回一个额外的 chunk。此 chunk 中， **usage** 字段中输出整个请求的 token 用量，**choices** 字段为空数组。
* `false`：输出结束前，没有一个 chunk 来返回 token 用量信息。


---


stream_options.**chunk_include_usage ** `boolean / null` `默认值 false`
模型流式输出时，输出的每个 chunk 中是否输出本次请求到此 chunk 输出时刻的累计 token 用量信息。

* `true`：在返回的 **usage** 字段中，输出本次请求到此 chunk 输出时刻的累计 token 用量。
* `false`：不在每个 chunk 都返回 token 用量信息。


---


**max_tokens** `integer / null` `默认值 4096`
取值范围：各个模型不同，详细见[模型列表](https://www.volcengine.com/docs/82379/1330310)。
模型回答最大长度（单位 token）。
:::tip

* 模型回答不包含思维链内容，模型回答 = 模型输出 \- 模型思维链（如有）
* 输出 token 的总长度还受模型的上下文长度限制。


:::
---


**max_completion_tokens** `integer / null` 
> 支持该字段的模型及使用说明见 [文档](https://www.volcengine.com/docs/82379/1449737#0001)。

取值范围：`[1, 65,536]`。
控制模型输出的最大长度（包括模型回答和模型思维链内容长度，单位 token）。
配置了该参数后，可以让模型输出超长内容，**max_tokens ** 默认值失效，模型按需输出内容（回答和思维链），直到达到 **max_completion_tokens ** 值。
不可与 **max_tokens** 字段同时设置。

---


**service_tier** `string / null` `默认值 auto`
控制是否使用[TPM保障包](https://www.volcengine.com/docs/82379/1510762)。取值范围：`auto`、`default`。

* `auto`：本次请求优先使用 TPM 保障包额度。
   * 有 TPM 保障包额度的推理接入点，本次请求将会优先使用 TPM 保障包额度，获得更高的服务等级（响应速度、可用性）。
   * 无 TPM 保障包额度或用超额度的推理接入点，维持默认的服务等级。
* `default`：本次请求不使用 TPM 保障包，维持默认的服务等级（即使推理接入点有TPM保障包额度）。


---


**stop** `string / string[] / null` `默认值 null`
模型遇到 stop 字段所指定的字符串时将停止继续生成，这个词语本身不会输出。最多支持 4 个字符串。
> [深度思考能力模型](https://www.volcengine.com/docs/82379/1330310#.6KeG6KeJ55CG6Kej6IO95Yqb)不支持该字段。

`["你好", "天气"]`

---


**reasoning_effort** `string / null` `默认值 medium`
> 支持该字段的模型、与 **thinking.type** 字段关系见[文档](https://www.volcengine.com/docs/82379/1449737#.6LCD6IqC5oCd6ICD6ZW_5bqm)。

限制思考的工作量。减少思考深度可提升速度，思考花费的 token 更少。
取值范围：`minimal`，`low`，`medium`，`high`。

* `minimal`：关闭思考，直接回答。
* `low`：轻量思考，侧重快速响应。
* `medium`：均衡模式，兼顾速度与深度。
* `high`：深度分析，处理复杂问题。


---


**response_format** `object`  `默认值 {"type": "text"}` `beta阶段`
指定模型回答格式。

回答格式说明

---


文本格式 `object`
模型默认回复文本格式内容。

属性

---


response_format.**type** `string` `必选`
此处应为 `text`。


---


JSON Object 格式 `object`
模型回复内容以JSON对象结构来组织。
> 支持该字段的模型请参见[文档](https://www.volcengine.com/docs/82379/1568221#.5pSv5oyB55qE5qih5Z6L)。
> 该能力尚在 beta 阶段，请谨慎在生产环境使用。


属性

---


response_format.**type ** `string` `必选`
此处应为`json_object`。


---


JSON Schema 格式 `object`  
模型回复内容以JSON对象结构来组织，遵循 **schema ** 字段定义的JSON结构。
> 支持该字段的模型请参见[文档](https://www.volcengine.com/docs/82379/1568221#.5pSv5oyB55qE5qih5Z6L)。
> 该能力尚在 beta 阶段，请谨慎在生产环境使用。


属性

---


response_format.**type ** `string` `必选`
此处应为`json_schema`。

---


response_format.**json_schema** `object` `必选`
JSON结构体的定义。

属性

---


response_format.json_schema.**name** `string` `必选`
用户自定义的JSON结构的名称。

---


response_format.json_schema.**description** `string / null` 
回复用途描述，模型将根据此描述决定如何以该格式回复。

---


response_format.json_schema.**schema** `object` `必选`
回复格式的 JSON 格式定义，以 JSON Schema 对象的形式描述。

---


response_format.json_schema.**strict** `boolean / null` `默认值 false`
是否在生成输出时，启用严格遵循模式。

* `true`：模型将始终严格遵循**schema**字段中定义的格式。
* `false`：模型会尽可能遵循**schema**字段中定义的结构。




---


**frequency_penalty** `float / null` `默认值 0`
取值范围为 [`-2.0`, `2.0`]。
频率惩罚系数。如值为正，根据新 token 在文本中的出现频率对其进行惩罚，从而降低模型逐字重复的可能性。

---


**presence_penalty** `float / null` `默认值 0`
取值范围为 [`-2.0`, `2.0`]。
存在惩罚系数。如果值为正，会根据新 token 到目前为止是否出现在文本中对其进行惩罚，从而增加模型谈论新主题的可能性。

---


**temperature** `float / null` `默认值 1`
取值范围为 [`0`, `2`]。
:::warning
当调用下列模型，字段取值固定为 `1`，手动指定的参数值将被忽略。

* `doubao-seed-2-0-pro-260215`
* `doubao-seed-2-0-lite-260215`

:::
采样温度。控制了生成文本时对每个候选词的概率分布进行平滑的程度。当取值为 0 时模型仅考虑对数概率最大的一个 token。
较高的值（如 0.8）会使输出更加随机，而较低的值（如 0.2）会使输出更加集中确定。
通常建议仅调整 temperature 或 top_p 其中之一，不建议两者都修改。

---


**top_p** `float / null` `默认值 0.7`
取值范围为 [`0`, `1`]。
:::warning
当调用下列模型，字段取值固定为 `0.95`，手动指定的参数值将被忽略。

* `doubao-seed-2-0-pro-260215`
* `doubao-seed-2-0-lite-260215`
* `doubao-seed-1-8-251228`

:::
核采样概率阈值。模型会考虑概率质量在 top_p 内的 token 结果。当取值为 0 时模型仅考虑对数概率最大的一个 token。
0.1 意味着只考虑概率质量最高的前 10% 的 token，取值越大生成的随机性越高，取值越低生成的确定性越高。通常建议仅调整 temperature 或 top_p 其中之一，不建议两者都修改。

---


**logprobs** `boolean / null` `默认值 false`
> 带深度思考能力模型不支持该字段，深度思考能力模型参见[文档](https://www.volcengine.com/docs/82379/1330310#.5rex5bqm5oCd6ICD6IO95Yqb)。

是否返回输出 tokens 的对数概率。

* `false`：不返回对数概率信息。
* `true`：返回消息内容中每个输出 token 的对数概率。


---


**top_logprobs** `integer / null` `默认值 0`
> 带深度思考能力模型不支持该字段，深度思考能力模型参见[文档](https://www.volcengine.com/docs/82379/1330310#.5rex5bqm5oCd6ICD6IO95Yqb)。

取值范围为 [`0`, `20`]。
指定每个输出 token 位置最有可能返回的 token 数量，每个 token 都有关联的对数概率。仅当 **logprobs为**`true` 时可以设置 **top_logprobs** 参数。

---


**logit_bias** `map / null` `默认值 null`
> 带深度思考能力模型不支持该字段，深度思考能力模型参见[文档](https://www.volcengine.com/docs/82379/1330310#.5rex5bqm5oCd6ICD6IO95Yqb)。

调整指定 token 在模型输出内容中出现的概率，使模型生成的内容更加符合特定的偏好。**logit_bias** 字段接受一个 map 值，其中每个键为词表中的 token ID（使用 tokenization 接口获取），每个值为该 token 的偏差值，取值范围为 [\-100, 100]。
\-1 会减少选择的可能性，1 会增加选择的可能性；\-100 会完全禁止选择该 token，100 会导致仅可选择该 token。该参数的实际效果可能因模型而异。
`{"<Token_ID>": -100}`

---


**tools** `object[] / null` `默认值 null`
待调用工具的列表，模型返回信息中可包含。当您需要让模型返回待调用工具时，需要配置该结构体。支持该字段的模型请参见[文档](https://www.volcengine.com/docs/82379/1330310#.5bel5YW36LCD55So6IO95Yqb)。

属性

---


tools.**type ** `string` `必选`
工具类型，此处应为 `function`。

---


tools.**function ** `object` `必选`
模型返回中可包含待调用的工具。

属性

---


tools.function.**name ** `string` `必选`
调用的函数的名称。

---


tools.function.**description ** `string` 
调用的函数的描述，大模型会使用它来判断是否调用这个工具。

---


tools.function.**parameters ** `object` 
函数请求参数，以 JSON Schema 格式描述。具体格式请参考 [JSON Schema](https://json-schema.org/understanding-json-schema) 文档，格式如下：
```JSON
{
  "type": "object",
  "properties": {
    "参数名": {
      "type": "string | number | boolean | object | array",
      "description": "参数说明"
    }
  },
  "required": ["必填参数"]
}
```

其中，

* 所有字段名大小写敏感。
* **parameters** 须是合规的 JSON Schema 对象。
* 建议用英文字段名，中文置于 **description** 字段中。



---


**parallel_tool_calls** `boolean` `默认值 true`
本次请求，模型返回是否允许包含多个待调用的工具。

* `true`：允许返回多个待调用的工具。
* `false`：允许返回的待调用的工具小于等于1，本取值在 `doubao-seed-1.6` 及之后系列模型生效。


---


**tool_choice** `string / object`
> 仅 `doubao-seed-1.6` 及之后系列模型支持此字段。

本次请求，模型返回信息中是否有待调用的工具。
当没有指定工具时，`none` 是默认值。如果存在工具，则 `auto` 是默认值。

可选类型

---


选择模式 `string`
控制模型返回是否包含待调用的工具。

* `none` ：模型返回信息中不可含有待调用的工具。
* `required` ：模型返回信息中必须含待调用的工具。选择此项时请确认存在适合的工具，以减少模型产生幻觉的情况。
* `auto` ：模型自行判断返回信息是否有待调用的工具。


---


工具调用 `object`
指定待调用工具的范围。模型返回信息中，只允许包含以下模型信息。选择此项时请确认该工具适合用户需求，以减少模型产生幻觉的情况。

属性

---


tool_choice.**type** `string` %%require%%
调用的类型，此处应为 `function`。

---


tool_choice.**function** `object`  %%require%%
调用工具的信息。

属性
tool_choice.function **.name ** `string` %%require%%
待调用工具的名称。



<span id="Qu59cel0"></span>
## 响应参数
> 跳转 [请求参数](#RxN8G2nH)

<span id="fT1TMaZk"></span>
### 非流式调用返回
> 跳转 [流式调用返回](#jp88SeXS)


---


**id** `string`
本次请求的唯一标识。

---


**model** `string`
本次请求实际使用的模型名称和版本。

---


**service_tier** `string`
本次请求是否使用了TPM保障包。

* `scale`：本次请求使用TPM保障包额度。
* `default`：本次请求未使用TPM保障包额度。


---


**created** `integer`
本次请求创建时间的 Unix 时间戳（秒）。

---


**object** `string`
固定为 `chat.completion`。

---


**choices** `object[]`
本次请求的模型输出内容。

属性

---


choices.**index ** `integer`
当前元素在 **choices** 列表的索引。

---


choices.**finish_reason ** `string`
模型停止生成 token 的原因。取值范围：

* `stop`：模型输出自然结束，或因命中请求参数 stop 中指定的字段而被截断。
* `length`：模型输出因达到模型输出限制而被截断，有以下原因：
   * 触发`max_tokens`限制（回答内容的长度限制）。
   * 触发`max_completion_tokens`限制（思维链内容+回答内容的长度限制）。
   * 触发`context_window`限制（输入内容+思维链内容+回答内容的长度限制）。
* `content_filter`：模型输出被内容审核拦截。
* `tool_calls`：模型调用了工具。


---


choices.**message ** `object`
模型输出的内容。

属性

---


choices.message.**role ** `string`
内容输出的角色，此处固定为 `assistant`。

---


choices.message.**content ** `string`
模型生成的消息内容。

---


choices.message.**reasoning_content ** `string / null`
模型处理问题的思维链内容。
仅深度推理模型支持返回此字段，深度推理模型请参见[支持模型](https://www.volcengine.com/docs/82379/1449737#5f0f3750)。

---


choices.message.**tool_calls ** `object[] / null`
模型生成的工具调用。

属性

---


choices.message.tool_calls.**id** ** ** `string`
调用的工具的 ID。

---


choices.message.tool_calls.**type ** `string`
工具类型，当前仅支持`function`。

---


choices.message.tool_calls.**function ** `object`
模型调用的函数。

属性

---


choices.message.tool_calls.function.**name ** `string`
模型调用的函数的名称。

---


choices.message.tool_calls.function.**arguments ** `string`
模型生成的用于调用函数的参数，JSON 格式。
模型并不总是生成有效的 JSON，并且可能会虚构出一些您的函数参数规范中未定义的参数。在调用函数之前，请在您的代码中验证这些参数是否有效。




---


choices.**logprobs ** `object / null`
当前内容的对数概率信息。

属性
choices.logprobs.**content ** `object[] / null`
message列表中每个 content 元素中的 token 对数概率信息。

属性

---


choices.logprobs.content.**token ** `string`
当前 token。

---


choices.logprobs.content.**bytes ** `integer[] / null`
当前 token 的 UTF\-8 值，格式为整数列表。当一个字符由多个 token 组成（表情符号或特殊字符等）时可以用于字符的编码和解码。如果 token 没有 UTF\-8 值则为空。

---


choices.logprobs.content.**logprob ** `float`
当前 token 的对数概率。

---


choices.logprobs.content.**top_logprobs ** `object[]`
在当前 token 位置最有可能的标记及其对数概率的列表。在一些情况下，返回的数量可能比请求参数 top_logprobs 指定的数量要少。

**属性**

---


choices.logprobs.content.top_logprobs.**token ** `string`
当前 token。

---


choices.logprobs.content.top_logprobs.**bytes ** `integer[] / null`
当前 token 的 UTF\-8 值，格式为整数列表。当一个字符由多个 token 组成（表情符号或特殊字符等）时可以用于字符的编码和解码。如果 token 没有 UTF\-8 值则为空。

---


choices.logprobs.content.top_logprobs.**logprob ** `float`
当前 token 的对数概率。




---


choices.**moderation_hit_type ** `string/ null`
模型输出文字含有敏感信息时，会返回模型输出文字命中的风险分类标签。
返回值及含义：

* `severe_violation`：模型输出文字涉及严重违规。
* `violence`：模型输出文字涉及激进行为。

注意：当前只有[视觉理解模型](https://www.volcengine.com/docs/82379/1362931#.5pSv5oyB5qih5Z6L)支持返回该字段，且只有在方舟控制台[接入点配置页面](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint/create?customModelId=)或者 [CreateEndpoint](https://www.volcengine.com/docs/82379/1262823) 接口中，将内容护栏方案（ModerationStrategy）设置为基础方案（Basic）时，才会返回风险分类标签。


---


**usage** `object`
本次请求的 token 用量。

属性

---


usage.**total_tokens ** `integer`
本次请求消耗的总 token 数量（输入 + 输出）。

---


usage.**prompt_tokens ** `integer`
输入给模型处理的内容 token 数量。

---


usage.**prompt_tokens_details ** `object`
输入给模型处理的内容 token 数量的细节。

属性

---


usage.prompt_tokens_details.**cached_tokens ** `integer`
缓存输入内容的 token 用量，此处应为 `0`。


---


usage.**completion_tokens ** `integer`
模型输出内容花费的 token。

---


usage.**completion_tokens_details ** `object`
模型输出内容花费的 token 的细节。

属性

---


usage.completion_tokens_details.**reasoning_tokens ** `integer`
输出思维链内容花费的 token 数 。
支持输出思维链的模型请参见[文档](https://www.volcengine.com/docs/82379/1449737#5f0f3750)。



---


&nbsp;
<span id="jp88SeXS"></span>
### 流式调用返回
> 跳转 [非流式调用返回](#fT1TMaZk)


---


**id** `string`
本次请求的唯一标识。

---


**model** `string`
本次请求实际使用的模型名称和版本。

---


**service_tier** `string`
本次请求是否使用了TPM保障包。

* `scale`：本次请求使用TPM保障包额度。
* `default`：本次请求未使用TPM保障包额度。


---


**created** `integer`
本次请求创建时间的 Unix 时间戳（秒）。

---


**object** `string`
固定为 `chat.completion.chunk`。

---


**choices** `object[]`
本次请求的模型输出内容。

属性

---


choices.**index ** `integer`
当前元素在 **choices** 列表的索引。

---


choices.**finish_reason ** `string`
模型停止生成 token 的原因。取值范围：

* `stop`：模型输出自然结束，或因命中请求参数 stop 中指定的字段而被截断。
* `length`：模型输出因达到模型输出限制而被截断，有以下原因：
   * 触发`max_tokens`限制（回答内容的长度限制）。
   * 触发`max_completion_tokens`限制（思维链内容+回答内容的长度限制）。
   * 触发`context_window`限制（输入内容+思维链内容+回答内容的长度限制）。
* `content_filter`：模型输出被内容审核拦截。
* `tool_calls`：模型调用了工具。


---


choices.**delta ** `object`
模型输出的增量内容。

属性

---


choices.delta.**role ** `string`
内容输出的角色，此处固定为 `assistant`。

---


choices.delta.**content ** `string`
模型生成的消息内容。

---


choices.delta.**reasoning_content ** `string / null`
思考内容原文。
仅深度推理模型支持返回此字段，深度推理模型请参见[支持模型](https://www.volcengine.com/docs/82379/1449737#5f0f3750)。

---


choices.delta.**tool_calls ** `object[] / null`
模型生成的工具调用。

属性

---


choices.delta.tool_calls.**id ** `string`
调用的工具的 ID。

---


choices.delta.tool_calls.**type ** `string`
工具类型，当前仅支持`function`。

---


choices.delta.tool_calls.**function ** `object`
模型调用的函数。

属性

---


choices.delta.tool_calls.function.**name ** `string`
模型调用的函数的名称。

---


choices.delta.tool_calls.function.**arguments ** `string`
模型生成的用于调用函数的参数，JSON 格式。
模型并不总是生成有效的 JSON，并且可能会虚构出一些您的函数参数规范中未定义的参数。在调用函数之前，请在您的代码中验证这些参数是否有效。




---


choices.**logprobs ** `object / null`
当前内容的对数概率信息。

属性

---


choices.logprobs.**content ** `object[] / null`
message列表中每个 content 元素中的 token 对数概率信息。

属性

---


choices.logprobs.content.**token ** `string`
当前 token。

---


choices.logprobs.content.**bytes ** `integer[] / null`
当前 token 的 UTF\-8 值，格式为整数列表。当一个字符由多个 token 组成（表情符号或特殊字符等）时可以用于字符的编码和解码。如果 token 没有 UTF\-8 值则为空。

---


choices.logprobs.content.**logprob ** `float`
当前 token 的对数概率。

---


choices.logprobs.content.**top_logprobs ** `object[]`
在当前 token 位置最有可能的标记及其对数概率的列表。在一些情况下，返回的数量可能比请求参数 top_logprobs 指定的数量要少。

属性

---


choices.logprobs.content.top_logprobs.**token ** `string`
当前 token。

---


choices.logprobs.content.top_logprobs.**bytes ** `integer[] / null`
当前 token 的 UTF\-8 值，格式为整数列表。当一个字符由多个 token 组成（表情符号或特殊字符等）时可以用于字符的编码和解码。如果 token 没有 UTF\-8 值则为空。

---


choices.logprobs.content.top_logprobs.**logprob ** `float`
当前 token 的对数概率。




---


choices.**moderation_hit_type ** `string/ null`
模型输出文字含有敏感信息时，会返回模型输出文字命中的风险分类标签。
返回值及含义：

* `severe_violation`：模型输出文字涉及严重违规。
* `violence`：模型输出文字涉及激进行为。

注意：当前只有[视觉理解模型](https://www.volcengine.com/docs/82379/1362931#.5pSv5oyB5qih5Z6L)支持返回该字段，且只有在方舟控制台[接入点配置页面](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint/create?customModelId=)或者 [CreateEndpoint](https://www.volcengine.com/docs/82379/1262823) 接口中，将内容护栏方案（ModerationStrategy）设置为基础方案（Basic）时，才会返回风险分类标签。


---


**usage** `object`
本次请求的 token 用量。
流式调用时，默认不统计 token 用量信息，返回值为`null`。
如需统计，需设置 **stream_options.include_usage**为`true`。

属性

---


usage.**total_tokens ** `integer`
本次请求消耗的总 token 数量（输入 + 输出）。

---


usage.**prompt_tokens ** `integer`
输入给模型处理的内容 token 数量。

---


usage.**prompt_tokens_details ** `object`
输入给模型处理的内容 token 数量的细节。

属性

---


usage.prompt_tokens_details.**cached_tokens ** `integer`
缓存输入内容的 token 用量，此处应为 `0`。


---


usage.**completion_tokens ** `integer`
模型输出内容花费的 token。

---


usage.**completion_tokens_details ** `object`
模型输出内容花费的 token 的细节。

属性

---


usage.completion_tokens_details.**reasoning_tokens ** `integer`
输出思维链内容花费的 token 数 。
支持输出思维链的模型请参见[文档](https://www.volcengine.com/docs/82379/1449737#5f0f3750)。




