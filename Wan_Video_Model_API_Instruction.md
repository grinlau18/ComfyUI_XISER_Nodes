# 通义万相-参考生视频API配置说明

通义万相参考生视频模型，参考输入视频中的角色形象和音色，搭配提示词生成保持角色一致性的视频。支持的能力包括：

- **基础能力**：支持选择视频时长（5/10秒）、指定视频分辨率（720P/1080P）、添加水印。

- **音频能力**：支持通过提示词生成声音，可参考输入视频的音色。

**多镜头叙事**：支持生成包含多个镜头的视频，并且在镜头切换时保持主体一致性。

**模型概览**

<table>
<colgroup>
<col style="width: 25%" />
<col style="width: 54%" />
<col style="width: 19%" />
</colgroup>
<tbody>
<tr>
<td style="text-align: left;"><strong>模型名称（model）</strong></td>
<td style="text-align: left;"><strong>模型简介</strong></td>
<td style="text-align: left;"><strong>输出视频规格</strong></td>
</tr>
<tr>
<td style="text-align: left;">wan2.6-r2v <strong>推荐</strong></td>
<td style="text-align: left;"><p>万相2.6<strong>（有声视频）</strong></p>
<p>基于参考视频的角色形象和音色，默认生成有声视频，支持多镜头叙事（自动分镜），支持自动配音</p></td>
<td style="text-align: left;"><p>分辨率档位：720P、1080P</p>
<p>视频时长：5秒、10秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
</tbody>
</table>

**HTTP调用**

由于文生视频任务耗时较长（通常为1-5分钟），API采用异步调用。整个流程包含 **“创建任务 -\> 轮询获取”** 两个核心步骤，具体如下：

具体耗时受限于排队任务数和服务执行情况，请在获取结果时耐心等待。

**步骤1：创建任务获取任务ID**

**北京地域**：POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

**新加坡地域**：POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

**弗吉尼亚地域**：POST https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

### 请求参数

请求头（Headers）

Content-Type string （必选）

请求内容类型。此参数必须设置为application/json。

Authorization string（必选）

请求身份认证。接口使用阿里云百炼API-Key进行身份认证。示例值：Bearer sk-xxxx。

X-DashScope-Async string （必选）

异步处理配置参数。HTTP请求只支持异步，必须设置为enable。

重要

缺少此请求头将报错：“current user api does not support synchronous calls”。

请求体（Request Body）

model string （必选）

模型名称。模型列表与价格详见模型价格。

示例值：wan2.6-r2v。

input object （必选）

输入的基本信息，如提示词等。

属性

prompt string （必选）

文本提示词。用来描述生成视频中期望包含的元素和视觉特点。

支持中英文，每个汉字、字母、标点占一个字符，超过部分会自动截断。

wan2.6-r2v：长度不超过1500个字符。

角色引用说明：通过“character1、character2”这类标识引用参考角色，每个参考视频仅包含单一角色。模型仅通过此方式识别视频中的角色。

示例值：character1在沙发上开心地看电影。

提示词的使用技巧请参见文生视频/图生视频Prompt指南。

negative_prompt string （可选）

反向提示词，用来描述不希望在视频画面中看到的内容，可以对视频画面进行限制。

支持中英文，长度不超过500个字符，超过部分会自动截断。

示例值：低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等。

reference_video_urls array\[string\] （必选）

重要

reference_video_urls直接影响费用，计费规则请参见计费与限流。

上传的参考视频文件 URL 数组。用于提取角色形象与音色（如有），以生成符合参考特征的视频。

最多支持 3 个视频。

传入多个视频时，按照数组顺序定义视频角色的顺序。即第 1 个 URL 对应 character1，第 2 个对应 character2，以此类推。

每个参考视频仅包含一个角色（如 character1 为小女孩，character2 为闹钟）。

URL支持 HTTP 或 HTTPS 协议。本地文件可通过上传文件获取临时URL。

单个视频要求：

格式：mp4、mov。

时长：2～30s。

文件大小：视频不超过100MB。

示例值：\["https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/xxx.mp4"\]。

parameters object （可选）

图像处理参数。如设置视频分辨率、开启prompt智能改写、添加水印等。

属性

size string （可选）

重要

size直接影响费用，费用 = 单价（基于分辨率）× 时长（秒）。同一模型：1080P \> 720P ，请在调用前确认模型价格。

size必须设置为具体数值（如 1280\*720），而不是 1:1或720P。

指定生成的视频分辨率，格式为宽\*高。该参数的默认值和可用枚举值依赖于 model 参数，规则如下：

wan2.6-r2v：默认值为 1920\*1080（1080P）。可选分辨率：720P、1080P对应的所有分辨率。

720P档位：可选的视频分辨率及其对应的视频宽高比为：

1280\*720：16:9。

720\*1280：9:16。

960\*960：1:1。

1088\*832：4:3。

832\*1088：3:4。

1080P档位：可选的视频分辨率及其对应的视频宽高比为：

1920\*1080： 16:9。

1080\*1920： 9:16。

1440\*1440： 1:1。

1632\*1248： 4:3。

1248\*1632： 3:4。

duration integer （可选）

重要

duration直接影响费用。费用 = 单价（基于分辨率）× 时长（秒）。

生成视频的时长，单位为秒。

wan2.6-r2v：可选值为5、10。默认值为5。

示例值：5。

shot_type string （可选）

指定生成视频的镜头类型，即视频是由一个连续镜头还是多个切换镜头组成。

参数优先级：shot_type \> prompt。例如，若 shot_type设置为"single"，即使 prompt 中包含“生成多镜头视频”，模型仍会输出单镜头视频。

可选值：

single：默认值，输出单镜头视频

multi：输出多镜头视频。

示例值：single。

说明

当希望严格控制视频的叙事结构（如产品展示用单镜头、故事短片用多镜头），可通过此参数指定。

watermark boolean （可选）

是否添加水印标识，水印位于视频右下角，文案固定为“AI生成”。

false：默认值，不添加水印。

true：添加水印。

示例值：false。

seed integer （可选）

随机数种子，取值范围为\[0, 2147483647\]。

未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。

请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。

示例值：12345。

#### 单角色参考

参考视频角色的形象和音色，设置shot_type为multi，生成多镜头视频。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.6-r2v",
    "input": {
        "prompt": "character1一边喝奶茶，一边随着音乐即兴跳舞。",
        "reference_video_urls":["https://cdn.wanx.aliyuncs.com/static/demo-wan26/vace.mp4"]
    },
    "parameters": {
        "size": "1280*720",
        "duration": 5,
        "shot_type":"multi"
    }
}'

#### 多角色参考

基于人物与道具的参考视频，通过提示词定义两者间的联系，设置shot_type为multi，生成多镜头视频。您可以在提示词中多次引用同一角色。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.6-r2v",
    "input": {
        "prompt": "character1对character2说: “I’ll rely on you tomorrow morning!” character2 回答: “You can count on me!”",
        "reference_video_urls": [
            "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251217/dlrrly/%E5%B0%8F%E5%A5%B3%E5%AD%A91%E8%8B%B1%E6%96%872.mp4",
            "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251217/fkxknn/%E9%93%83%E9%93%83.mp4"
        ]
    },
    "parameters": {
        "size": "1280*720",
        "duration": 10,
        "shot_type": "multi"
    }
}'

### 响应参数

output object

任务输出信息。

属性

task_id string

任务ID。查询有效期24小时。

task_status string

任务状态。

枚举值

PENDING：任务排队中

RUNNING：任务处理中

SUCCEEDED：任务执行成功

FAILED：任务执行失败

CANCELED：任务已取消

UNKNOWN：任务不存在或状态未知

request_id string

请求唯一标识。可用于请求明细溯源和问题排查。

code string

请求失败的错误码。请求成功时不会返回此参数，详情请参见错误信息。

message string

请求失败的详细信息。请求成功时不会返回此参数，详情请参见错误信息。

#### 响应成功

请保存 task_id，用于查询任务状态与结果。

{
    "output": {
        "task_status": "PENDING",
        "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx"
    },
    "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx"
}

#### 响应异常

创建任务失败，请参见错误信息进行解决。

{
    "code": "InvalidApiKey",
    "message": "No API-key provided.",
    "request_id": "7438d53d-6eb8-4596-8835-xxxxxx"
}

### 根据任务ID查询结果

请求头（Headers）

Authorization string（必选）

请求身份认证。接口使用阿里云百炼API-Key进行身份认证。示例值：Bearer sk-xxxx。

URL路径参数（Path parameters）

task_id string（必选）

任务ID。

output object

任务输出信息。

属性

task_id string（必选）

任务ID。

task_status string

任务状态。

枚举值

PENDING：任务排队中

RUNNING：任务处理中

SUCCEEDED：任务执行成功

FAILED：任务执行失败

CANCELED：任务已取消

UNKNOWN：任务不存在或状态未知

submit_time string

任务提交时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。

scheduled_time string

任务执行时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。

end_time string

任务完成时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。

video_url string

视频URL。仅在 task_status 为 SUCCEEDED 时返回。

链接有效期24小时，可通过此URL下载视频。视频格式为MP4（H.264 编码）。

orig_prompt string

原始输入的prompt，对应请求参数prompt。

actual_prompt string

当 prompt_extend=true 时，系统会对输入 prompt 进行智能改写，此字段返回实际用于生成的优化后 prompt。若 prompt_extend=false，该字段不会返回。

注意：wan2.6 模型无论 prompt_extend 取值如何，均不返回此字段。

code string

请求失败的错误码。请求成功时不会返回此参数，详情请参见错误信息。

message string

请求失败的详细信息。请求成功时不会返回此参数，详情请参见错误信息。

usage object

输出信息统计。只对成功的结果计数。

属性

input_video_duration integer

输入的参考视频的时长，单位秒。

output_video_duration integer

输出视频的时长，单位秒。

duration float

总视频时长。计费按duration时长计算。

计算公式：duration = input_video_duration + output_video_duration。

SR integer

生成视频的分辨率档位。示例值：720。

sizestring

生成视频的分辨率。格式为“宽\*高”，示例值：1280\*720。

video_count integer

生成视频的数量。固定为1。

request_id string

请求唯一标识。可用于请求明细溯源和问题排查。

#### 查询任务

请将86ecf553-d340-4e21-xxxxxxxxx替换为真实的task_id。

若使用新加坡地域的模型，需将base_url替换为https://dashscope-intl.aliyuncs.com/api/v1/tasks/86ecf553-d340-4e21-xxxxxxxxx

curl -X GET https://dashscope.aliyuncs.com/api/v1/tasks/86ecf553-d340-4e21-xxxxxxxxx \
--header "Authorization: Bearer $DASHSCOPE_API_KEY"

#### 任务执行成功

视频URL仅保留24小时，超时后会被自动清除，请及时保存生成的视频。

{
    "request_id": "caa62a12-8841-41a6-8af2-xxxxxx",
    "output": {
        "task_id": "eff1443c-ccab-4676-aad3-xxxxxx",
        "task_status": "SUCCEEDED",
        "submit_time": "2025-12-16 00:25:59.869",
        "scheduled_time": "2025-12-16 00:25:59.900",
        "end_time": "2025-12-16 00:30:35.396",
        "orig_prompt": "character1在沙发上开心的看电影",
        "video_url": "https://dashscope-result-sh.oss-accelerate.aliyuncs.com/xxx.mp4?Expires=xxx"
    },
     "usage": {
        "duration": 10.0,
        "size": "1280*720",
        "input_video_duration": 5,
        "output_video_duration": 5,
        "video_count": 1,
        "SR": 720
    }
}

#### 任务执行失败

若任务执行失败，task_status将置为 FAILED，并提供错误码和信息。请参见错误信息进行解决。

{
    "request_id": "e5d70b02-ebd3-98ce-9fe8-759d7d7b107d",
    "output": {
        "task_id": "86ecf553-d340-4e21-af6e-a0c6a421c010",
        "task_status": "FAILED",
        "code": "InvalidParameter",
        "message": "The size is not match xxxxxx"
    }
}

#### 任务查询过期

task_id查询有效期为 24 小时，超时后将无法查询，返回以下报错信息。

{
    "request_id": "a4de7c32-7057-9f82-8581-xxxxxx",
    "output": {
        "task_id": "502a00b1-19d9-4839-a82f-xxxxxx",
        "task_status": "UNKNOWN"
    }
}

# 通义万相-图生视频-基于首帧

- 通义万相-图生视频模型根据首帧图像和文本提示词，生成一段流畅的视频。支持的能力包括：

- 基础能力：支持选择视频时长（ 3/4/5/10/15秒）、指定视频分辨率（480P/720P/1080P）、智能改写prompt、添加水印。

- 音频能力：支持自动配音，或传入自定义音频文件，实现音画同步。（wan2.5、wan2.6支持）

- 多镜头叙事：支持生成包含多个镜头的视频，在镜头切换时保持主体一致性。（仅wan2.6支持）

- 视频特效：部分模型内置“魔法悬浮”、“气球膨胀”等特效模板，可直接调用。

<table>
<colgroup>
<col style="width: 38%" />
<col style="width: 37%" />
<col style="width: 24%" />
</colgroup>
<tbody>
<tr>
<td style="text-align: left;"><strong>模型名称（model）</strong></td>
<td style="text-align: left;"><strong>模型简介</strong></td>
<td style="text-align: left;"><strong>输出视频规格</strong></td>
</tr>
<tr>
<td style="text-align: left;">wan2.6-i2v <strong>推荐</strong></td>
<td style="text-align: left;"><p>万相2.6<strong>（有声视频）</strong></p>
<p><strong>新增多镜头叙事能力</strong></p>
<p>支持<strong>音频</strong>能力：支持自动配音，或传入自定义音频文件</p></td>
<td style="text-align: left;"><p>分辨率档位：720P、1080P</p>
<p>视频时长：5秒、10秒、15秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
<tr>
<td style="text-align: left;">wan2.5-i2v-preview <strong>推荐</strong></td>
<td style="text-align: left;"><p>万相2.5 preview<strong>（有声视频）</strong></p>
<p>新增<strong>音频</strong>能力：支持自动配音，或传入自定义音频文件</p></td>
<td style="text-align: left;"><p>分辨率档位：480P、720P、1080P</p>
<p>视频时长：5秒，10秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
<tr>
<td style="text-align: left;">wan2.2-i2v-flash</td>
<td style="text-align: left;"><p>万相2.2极速版（无声视频）</p>
<p>较2.1模型速度提升50%</p></td>
<td style="text-align: left;"><p>分辨率档位：480P、720P、1080P</p>
<p>视频时长：5秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
<tr>
<td style="text-align: left;">wan2.2-i2v-plus</td>
<td style="text-align: left;"><p>万相2.2专业版（无声视频）</p>
<p>较2.1模型稳定性与成功率全面提升</p></td>
<td style="text-align: left;"><p>分辨率档位：480P、1080P</p>
<p>视频时长：5秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
<tr>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;">万相2.1专业版（无声视频）</td>
<td style="text-align: left;"><p>分辨率档位：720P</p>
<p>视频时长：5秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
<tr>
<td style="text-align: left;">wanx2.1-i2v-turbo</td>
<td style="text-align: left;">万相2.1极速版（无声视频）</td>
<td style="text-align: left;"><p>分辨率档位：480P、720P</p>
<p>视频时长：3、4、5秒</p>
<p>固定规格：30fps、MP4 (H.264编码) </p></td>
</tr>
</tbody>
</table>

HTTP调用

由于图生视频任务耗时较长（通常为1-5分钟），API采用异步调用。整个流程包含 “创建任务 -\> 轮询获取” 两个核心步骤，具体如下：

具体耗时受限于排队任务数和服务执行情况，请在获取结果时耐心等待。

步骤1：创建任务获取任务ID

北京地域：POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

新加坡地域：POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

弗吉尼亚地域：POST https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis

说明

创建成功后，使用接口返回的 task_id 查询结果，task_id 有效期为 24 小时。请勿重复创建任务，轮询获取即可。

新手指引请参见Postman。

### 请求参数

请求头（Headers）

Content-Type string （必选）

请求内容类型。此参数必须设置为application/json。

Authorization string（必选）

请求身份认证。接口使用阿里云百炼API-Key进行身份认证。示例值：Bearer sk-xxxx。

X-DashScope-Async string （必选）

异步处理配置参数。HTTP请求只支持异步，必须设置为enable。

重要

缺少此请求头将报错：“current user api does not support synchronous calls”。

请求体（Request Body）

model string （必选）

模型名称。示例值：wan2.5-i2v-preview。

模型列表与价格详见模型价格。

input object （必选）

输入的基本信息，如提示词等。

属性

prompt string （可选）

文本提示词。用来描述生成图像中期望包含的元素和视觉特点。

支持中英文，每个汉字/字母占一个字符，超过部分会自动截断。长度限制因模型版本而异：

wan2.6-i2v：长度不超过1500个字符。

wan2.5-i2v-preview：长度不超过1500个字符。

wan2.2及以下版本模型：长度不超过800个字符。

当使用视频特效参数（即template不为空）时，prompt参数无效，无需填写。

示例值：一只小猫在草地上奔跑。

提示词使用技巧详见文生视频/图生视频Prompt指南。

negative_prompt string （可选）

反向提示词，用来描述不希望在视频画面中看到的内容，可以对视频画面进行限制。

支持中英文，长度不超过500个字符，超过部分会自动截断。

示例值：低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等。

img_url string （必选）

首帧图像的URL或 Base64 编码数据。

图像限制：

图像格式：JPEG、JPG、PNG（不支持透明通道）、BMP、WEBP。

图像分辨率：图像的宽度和高度范围为\[360, 2000\]，单位为像素。

文件大小：不超过10MB。

输入图像说明：

使用公网可访问URL

支持 HTTP 或 HTTPS 协议。本地文件可通过上传文件获取临时URL。

示例值：https://cdn.translate.alibaba.com/r/wanx-demo-1.png。

传入 Base64 编码图像后的字符串

数据格式：data:{MIME_type};base64,{base64_data}。

示例值：data:image/png;base64,GDU7MtCZzEbTbmRZ......。（编码字符串过长，仅展示片段）

更多内容请参见输入图像。

audio_url string （可选）

支持模型：wan2.6-i2v、 wan2.5-i2v-preview。

音频文件的 URL，模型将使用该音频生成视频。使用方式参见音频设置。

支持 HTTP 或 HTTPS 协议。本地文件可通过上传文件获取临时URL。

音频限制：

格式：wav、mp3。

时长：3～30s。

文件大小：不超过15MB。

超限处理：若音频长度超过 duration 值（5秒或10秒），自动截取前5秒或10秒，其余部分丢弃。若音频长度不足视频时长，超出音频长度部分为无声视频。例如，音频为3秒，视频时长为5秒，输出视频前3秒有声，后2秒无声。

示例值：https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/ozwpvi/rap.mp3。

template string （可选）

视频特效模板的名称。若未填写，表示不使用任何视频特效。

不同模型支持不同的特效模板。调用前请查阅视频特效列表，以免调用失败。

示例值：flying，表示使用“魔法悬浮”特效。

parameters object （可选）

视频处理参数，如设置视频分辨率、设置视频时长、开启prompt智能改写、添加水印等。

属性

resolution string （可选）

重要

resolution直接影响费用，同一模型：1080P \> 720P \> 480P，请在调用前确认模型价格。

指定生成的视频分辨率档位，用于调整视频的清晰度（总像素）。模型根据选择的分辨率档位，自动缩放至相近总像素，视频宽高比将尽量与输入图像 img_url 的宽高比保持一致，更多说明详见常见问题。

此参数的默认值和可用枚举值依赖于 model 参数，规则如下：

wan2.6-i2v ：可选值：720P、1080P。默认值为1080P。

wan2.5-i2v-preview ：可选值：480P、720P、1080P。默认值为1080P。

wan2.2-i2v-flash：可选值：480P、720P、1080P。默认值为720P。

wan2.2-i2v-plus：可选值：480P、1080P。默认值为1080P。

wanx2.1-i2v-turbo：可选值：480P、720P。默认值为720P。

wanx2.1-i2v-plus：可选值：720P。默认值为720P。

示例值：1080P。

duration integer （可选）

重要

duration直接影响费用，按秒计费，时间越长费用越高，请在调用前确认模型价格。

生成视频的时长，单位为秒。该参数的取值依赖于 model参数：

wan2.6-i2v：可选值为5、10、15。默认值为5。

wan2.5-i2v-preview：可选值为5、10。默认值为5。

wan2.2-i2v-plus：固定为5秒，且不支持修改。

wan2.2-i2v-flash：固定为5秒，且不支持修改。

wanx2.1-i2v-plus：固定为5秒，且不支持修改。

wanx2.1-i2v-turbo：可选值为3、4或5。默认值为5。

示例值：5。

prompt_extend boolean （可选）

是否开启prompt智能改写。开启后使用大模型对输入prompt进行智能改写。对于较短的prompt生成效果提升明显，但会增加耗时。

true：默认值，开启智能改写。

false：不开启智能改写。

示例值：true。

shot_type string （可选）

支持模型：wan2.6-i2v。

指定生成视频的镜头类型，即视频是由一个连续镜头还是多个切换镜头组成。

生效条件：仅当"prompt_extend": true 时生效。

参数优先级：shot_type \> prompt。例如，若 shot_type设置为"single"，即使 prompt 中包含“生成多镜头视频”，模型仍会输出单镜头视频。

可选值：

single：默认值，输出单镜头视频

multi：输出多镜头视频。

示例值：single。

说明

当希望严格控制视频的叙事结构（如产品展示用单镜头、故事短片用多镜头），可通过此参数指定。

watermark boolean （可选）

是否添加水印标识，水印位于视频右下角，文案固定为“AI生成”。

false：默认值，不添加水印。

true：添加水印。

示例值：false。

seed integer （可选）

随机数种子，取值范围为\[0, 2147483647\]。

未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。

请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。

示例值：12345。

### 多镜头叙事

仅 wan2.6-i2v模型支持生成多镜头视频。

可通过设置"prompt_extend": true和"shot_type":"multi"启用。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.6-i2v-flash",
    "input": {
        "prompt": "一幅都市奇幻艺术的场景。一个充满动感的涂鸦艺术角色。一个由喷漆所画成的少年，正从一面混凝土墙上活过来。他一边用极快的语速演唱一首英文rap，一边摆着一个经典的、充满活力的说唱歌手姿势。场景设定在夜晚一个充满都市感的铁路桥下。灯光来自一盏孤零零的街灯，营造出电影般的氛围，充满高能量和惊人的细节。视频的音频部分完全由他的rap构成，没有其他对话或杂音。",
        "img_url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/wpimhv/rap.png",
        "audio_url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/ozwpvi/rap.mp3"
    },
    "parameters": {
        "resolution": "720P",
        "prompt_extend": true,
        "duration": 10,
        "shot_type":"multi"
    }
}'

### 自动配音

仅 wan2.5 及以上版本模型支持此功能。

若不提供 input.audio_url ，模型将根据视频内容自动生成匹配的背景音乐或音效。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.5-i2v-preview",
    "input": {
        "prompt": "一幅都市奇幻艺术的场景。一个充满动感的涂鸦艺术角色。一个由喷漆所画成的少年，正从一面混凝土墙上活过来。他一边用极快的语速演唱一首英文rap，一边摆着一个经典的、充满活力的说唱歌手姿势。场景设定在夜晚一个充满都市感的铁路桥下。灯光来自一盏孤零零的街灯，营造出电影般的氛围，充满高能量和惊人的细节。视频的音频部分完全由他的rap构成，没有其他对话或杂音。",
        "img_url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/wpimhv/rap.png"
    },
    "parameters": {
        "resolution": "480P",
        "prompt_extend": true,
        "duration": 10
    }
}'

### 传入音频文件

仅 wan2.5 及以上版本模型支持此功能。

如需为视频指定背景音乐或配音，可通过 input.audio_url 参数传入自定义音频的 URL。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.5-i2v-preview",
    "input": {
        "prompt": "一幅都市奇幻艺术的场景。一个充满动感的涂鸦艺术角色。一个由喷漆所画成的少年，正从一面混凝土墙上活过来。他一边用极快的语速演唱一首英文rap，一边摆着一个经典的、充满活力的说唱歌手姿势。场景设定在夜晚一个充满都市感的铁路桥下。灯光来自一盏孤零零的街灯，营造出电影般的氛围，充满高能量和惊人的细节。视频的音频部分完全由他的rap构成，没有其他对话或杂音。",
        "img_url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/wpimhv/rap.png",
        "audio_url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/ozwpvi/rap.mp3"
    },
    "parameters": {
        "resolution": "480P",
        "prompt_extend": true,
        "duration": 10
    }
}'

### 使用Base64

您可以通过 img_url 参数传入图像的 Base64 编码字符串，以代替公开可访问的 URL。关于 Base64 字符串的格式要求，请参见输入图像。

示例：下载img_base64文件，并将完整内容粘贴至img_url参数中。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.2-i2v-plus",
    "input": {
        "prompt": "一只猫在草地上奔跑",
        "img_url": "data:image/png;base64,GDU7MtCZzEbTbmRZ......"
    },
    "parameters": {
        "resolution": "480P",
        "prompt_extend": true
    }
}'

### 使用反向提示词

通过 negative_prompt 指定生成的视频避免出现“花朵”元素。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.2-i2v-plus",
    "input": {
        "prompt": "一只猫在草地上奔跑",
        "negative_prompt": "花朵",
        "img_url": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png"
    },
    "parameters": {
        "resolution": "480P",
        "prompt_extend": true
    }
}'

### 生成无声视频

wan2.2 及以下版本模型默认生成无声视频，无需设置任何参数。

wan2.5 及以上版本模型默认生成有声视频。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.2-i2v-plus",
    "input": {
        "prompt": "一只猫在草地上奔跑",
        "img_url": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png"
    },
    "parameters": {
        "resolution": "480P",
        "prompt_extend": true
    }
}'

### 使用视频特效

prompt 字段将被忽略，建议留空。

特效的可用性与模型相关。调用前请查阅视频特效列表，以免调用失败。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wanx2.1-i2v-turbo",
    "input": {
        "img_url": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png",
        "template": "flying"
    },
    "parameters": {
        "resolution": "720P"
    }
}'

#### 通用特效

<table style="width:100%;">
<colgroup>
<col style="width: 10%" />
<col style="width: 20%" />
<col style="width: 33%" />
<col style="width: 35%" />
</colgroup>
<tbody>
<tr>
<td style="text-align: left;"><strong>特效名称</strong></td>
<td style="text-align: left;"><strong>template参数值</strong></td>
<td style="text-align: left;"><strong>支持模型</strong></td>
<td style="text-align: left;"><strong>输入图像建议</strong></td>
</tr>
<tr>
<td style="text-align: left;">解压捏捏</td>
<td style="text-align: left;"><strong>squish</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">转圈圈</td>
<td style="text-align: left;"><strong>rotation</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">戳戳乐</td>
<td style="text-align: left;"><strong>poke</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">气球膨胀</td>
<td style="text-align: left;"><strong>inflate</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">分子扩散</td>
<td style="text-align: left;"><strong>dissolve</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">热浪融化</td>
<td style="text-align: left;"><strong>melt</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">冰淇淋星球</td>
<td style="text-align: left;"><strong>icecream</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持任意主体</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用主体突出，与背景有明显区分度的图片</p>
<ul>
<li></li>
</ul></td>
</tr>
</tbody>
</table>

#### 单人特效

<table>
<colgroup>
<col style="width: 9%" />
<col style="width: 23%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<tbody>
<tr>
<td style="text-align: left;"><strong>特效名称</strong></td>
<td style="text-align: left;"><strong>template参数值</strong></td>
<td style="text-align: left;"><strong>支持模型</strong></td>
<td style="text-align: left;"><strong>输入图像建议</strong></td>
</tr>
<tr>
<td style="text-align: left;">时光木马</td>
<td style="text-align: left;"><strong>carousel</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">爱你哟</td>
<td style="text-align: left;"><strong>singleheart</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">摇摆时刻</td>
<td style="text-align: left;"><strong>dance1</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">头号甩舞</td>
<td style="text-align: left;"><strong>dance2</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用全身正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">星摇时刻</td>
<td style="text-align: left;"><strong>dance3</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用全身正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">指感节奏</td>
<td style="text-align: left;"><strong>dance4</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">舞动开关</td>
<td style="text-align: left;"><strong>dance5</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">人鱼觉醒</td>
<td style="text-align: left;"><strong>mermaid</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">学术加冕</td>
<td style="text-align: left;"><strong>graduation</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">巨兽追袭</td>
<td style="text-align: left;"><strong>dragon</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">财从天降</td>
<td style="text-align: left;"><strong>money</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">水母之约</td>
<td style="text-align: left;"><strong>jellyfish</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">瞳孔穿越</td>
<td style="text-align: left;"><strong>pupil</strong></td>
<td style="text-align: left;">wanx2.1-i2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
</tbody>
</table>

#### 双人特效

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 24%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<tbody>
<tr>
<td style="text-align: left;"><strong>特效名称</strong></td>
<td style="text-align: left;"><strong>template参数值</strong></td>
<td style="text-align: left;"><strong>支持模型</strong></td>
<td style="text-align: left;"><strong>输入图像建议</strong></td>
</tr>
<tr>
<td style="text-align: left;">爱的抱抱</td>
<td style="text-align: left;"><strong>hug</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持双人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议两人正面看向镜头或相对站立 （面对面），可为半身或全身照</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">唇齿相依</td>
<td style="text-align: left;"><strong>frenchkiss</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持双人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议两人正面看向镜头或相对站立 （面对面），可为半身或全身照</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">双倍心动</td>
<td style="text-align: left;"><strong>coupleheart</strong></td>
<td style="text-align: left;"><p>wanx2.1-i2v-plus</p>
<p>wanx2.1-i2v-turbo</p></td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持双人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议两人正面看向镜头或相对站立 （面对面），可为半身或全身照</p>
<ul>
<li></li>
</ul></td>
</tr>
</tbody>
</table>

#### 首尾帧生视频特效（单人特效）

|              |                    |              |              |                  |
|:-------------|:-------------------|:-------------|:-------------|:-----------------|
| **特效名称** | **template参数值** | **示例效果** | **支持模型** | **输入图像建议** |

<table style="width:100%;">
<colgroup>
<col style="width: 8%" />
<col style="width: 20%" />
<col style="width: 8%" />
<col style="width: 33%" />
<col style="width: 27%" />
</colgroup>
<tbody>
<tr>
<td style="text-align: left;"><strong>特效名称</strong></td>
<td style="text-align: left;"><strong>template参数值</strong></td>
<td style="text-align: left;"><strong>示例效果</strong></td>
<td style="text-align: left;"><strong>支持模型</strong></td>
<td style="text-align: left;"><strong>输入图像建议</strong></td>
</tr>
<tr>
<td style="text-align: left;">唐韵翩然</td>
<td style="text-align: left;"><strong>hanfu-1</strong></td>
<td style="text-align: left;"></td>
<td style="text-align: left;">wanx2.1-kf2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">机甲变身</td>
<td style="text-align: left;"><strong>solaron</strong></td>
<td style="text-align: left;"></td>
<td style="text-align: left;">wanx2.1-kf2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">闪耀封面</td>
<td style="text-align: left;"><strong>magazine</strong></td>
<td style="text-align: left;"></td>
<td style="text-align: left;">wanx2.1-kf2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">机械觉醒</td>
<td style="text-align: left;"><strong>mech1</strong></td>
<td style="text-align: left;"></td>
<td style="text-align: left;">wanx2.1-kf2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
<tr>
<td style="text-align: left;">赛博登场</td>
<td style="text-align: left;"><strong>mech2</strong></td>
<td style="text-align: left;"></td>
<td style="text-align: left;">wanx2.1-kf2v-plus</td>
<td style="text-align: left;"><ul>
<li></li>
</ul>
<p>支持单人照片</p>
<ul>
<li></li>
<li></li>
</ul>
<p>建议使用半身至全身的正面照片</p>
<ul>
<li></li>
</ul></td>
</tr>
</tbody>
</table>

#### 代码示例

1、图生视频-基于首帧

首帧特效：对首帧图像生成特效视频。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wanx2.1-i2v-turbo",
    "input": {
        "img_url": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png",
        "template": "flying"
    },
    "parameters": {
        "resolution": "720P"
    }
}'

2.  图生视频-基于首尾帧

首尾帧特效：只需提供一张首帧图像，无需尾帧图像，即可生成视频特效。

若同时提供first_frame_url、last_frame_url、template，将忽略last_frame_url。

若仅提供last_frame_url、template，请求将报错。

curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wanx2.1-kf2v-plus",
    "input": {
        "first_frame_url": "https://ty-yuanfang.oss-cn-hangzhou.aliyuncs.com/lizhengjia.lzj/tmp/11.png",
        "template": "hanfu-1"
    },
    "parameters": {
        "resolution": "720P",
        "prompt_extend": true
    }
}'

### 响应参数

output object

任务输出信息。

属性

task_id string

任务ID。查询有效期24小时。

task_status string

任务状态。

枚举值

PENDING：任务排队中

RUNNING：任务处理中

SUCCEEDED：任务执行成功

FAILED：任务执行失败

CANCELED：任务已取消

UNKNOWN：任务不存在或状态未知

request_id string

请求唯一标识。可用于请求明细溯源和问题排查。

code string

请求失败的错误码。请求成功时不会返回此参数，详情请参见错误信息。

message string

请求失败的详细信息。请求成功时不会返回此参数，详情请参见错误信息。

#### 成功响应

请保存 task_id，用于查询任务状态与结果。

{
    "output": {
        "task_status": "PENDING",
        "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx"
    },
    "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx"
}

#### 异常响应

创建任务失败，请参见错误信息进行解决。

{
    "code": "InvalidApiKey",
    "message": "No API-key provided.",
    "request_id": "7438d53d-6eb8-4596-8835-xxxxxx"
}

### **根据任务ID查询结果**

请求参数

请求头（Headers）

Authorization string（必选）

请求身份认证。接口使用阿里云百炼API-Key进行身份认证。示例值：Bearer sk-xxxx。

URL路径参数（Path parameters）

task_id string（必选）

任务ID。

响应参数

output object

任务输出信息。

属性

task_id string（必选）

任务ID。

task_status string

任务状态。

枚举值

PENDING：任务排队中

RUNNING：任务处理中

SUCCEEDED：任务执行成功

FAILED：任务执行失败

CANCELED：任务已取消

UNKNOWN：任务不存在或状态未知

submit_time string

任务提交时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。

scheduled_time string

任务执行时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。

end_time string

任务完成时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。

video_url string

视频URL。仅在 task_status 为 SUCCEEDED 时返回。

链接有效期24小时，可通过此URL下载视频。视频格式为MP4（H.264 编码）。

orig_prompt string

原始输入的prompt，对应请求参数prompt。

actual_prompt string

当 prompt_extend=true 时，系统会对输入 prompt 进行智能改写，此字段返回实际用于生成的优化后 prompt。若 prompt_extend=false，该字段不会返回。

注意：wan2.6 模型无论 prompt_extend 取值如何，均不返回此字段。

code string

请求失败的错误码。请求成功时不会返回此参数，详情请参见错误信息。

message string

请求失败的详细信息。请求成功时不会返回此参数，详情请参见错误信息。

usage object

输出信息统计。只对成功的结果计数。

属性

input_video_duration integer

输入的参考视频的时长，单位秒。

output_video_duration integer

输出视频的时长，单位秒。

duration float

总视频时长。计费按duration时长计算。

计算公式：duration = input_video_duration + output_video_duration。

SR integer

生成视频的分辨率档位。示例值：720。

sizestring

生成视频的分辨率。格式为“宽\*高”，示例值：1280\*720。

video_count integer

生成视频的数量。固定为1。

request_id string

请求唯一标识。可用于请求明细溯源和问题排查。

#### 查询任务结果

请将86ecf553-d340-4e21-xxxxxxxxx替换为真实的task_id。

若使用新加坡地域的模型，需将base_url替换为https://dashscope-intl.aliyuncs.com/api/v1/tasks/86ecf553-d340-4e21-xxxxxxxxx

curl -X GET https://dashscope.aliyuncs.com/api/v1/tasks/86ecf553-d340-4e21-xxxxxxxxx \\

--header "Authorization: Bearer \$DASHSCOPE_API_KEY"

#### 任务执行成功

视频URL仅保留24小时，超时后会被自动清除，请及时保存生成的视频。

{
    "request_id": "2ca1c497-f9e0-449d-9a3f-xxxxxx",
    "output": {
        "task_id": "af6efbc0-4bef-4194-8246-xxxxxx",
        "task_status": "SUCCEEDED",
        "submit_time": "2025-09-25 11:07:28.590",
        "scheduled_time": "2025-09-25 11:07:35.349",
        "end_time": "2025-09-25 11:17:11.650",
        "orig_prompt": "一幅都市奇幻艺术的场景。一个充满动感的涂鸦艺术角色。一个由喷漆所画成的少年，正从一面混凝土墙上活过来。他一边用极快的语速演唱一首英文rap，一边摆着一个经典的、充满活力的说唱歌手姿势。场景设定在夜晚一个充满都市感的铁路桥下。灯光来自一盏孤零零的街灯，营造出电影般的氛围，充满高能量和惊人的细节。视频的音频部分完全由他的rap构成，没有其他对话或杂音。",
        "video_url": "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/xxx.mp4?Expires=xxx"
    },
    "usage": {
        "duration": 10,
        "input_video_duration": 0,
        "output_video_duration": 10,
        "video_count": 1,
        "SR": 720
    }
}

#### 任务执行失败

若任务执行失败，task_status将置为 FAILED，并提供错误码和信息。请参见错误信息进行解决。

{
    "request_id": "e5d70b02-ebd3-98ce-9fe8-759d7d7b107d",
    "output": {
        "task_id": "86ecf553-d340-4e21-af6e-a0c6a421c010",
        "task_status": "FAILED",
        "code": "InvalidParameter",
        "message": "The size is not match xxxxxx"
    }
}

#### 任务过期

task_id查询有效期为 24 小时，超时后将无法查询，返回以下报错信息。

{
    "request_id": "a4de7c32-7057-9f82-8581-xxxxxx",
    "output": {
        "task_id": "502a00b1-19d9-4839-a82f-xxxxxx",
        "task_status": "UNKNOWN"
    }
}


# 通义万相-图生视频-基于首尾帧

通义万相首尾帧生视频模型基于首帧图像、尾帧图像和文本提示词，生成一段平滑过渡的视频。支持的能力包括：

基础能力：视频时长固定（5秒）、指定视频分辨率（480P/720P/1080P）、智能改写prompt、添加水印。

特效模板：仅输入首帧图片，并选择一个特效模板，即可生成具有特定动态效果的视频。


模型名称（model）/ 模型简介 / 输出视频规格

### wan2.2-kf2v-flash 推荐

万相2.2极速版（无声视频）

较2.1模型速度提升50%，稳定性与成功率全面提升

分辨率档位：480P、720P、1080P

视频时长：5秒

固定规格：30fps、MP4（H.264编码）

### wanx2.1-kf2v-plus

万相2.1专业版（无声视频）

复杂运动，物理规律还原，画面细腻

分辨率档位：720P

视频时长：5秒

固定规格：30fps、MP4（H.264编码）


### 请求参数

#### 请求头（Headers）
Content-Type string （必选）

请求内容类型。此参数必须设置为application/json。

Authorization string（必选）

请求身份认证。接口使用阿里云百炼API-Key进行身份认证。示例值：Bearer sk-xxxx。

X-DashScope-Async string （必选）

异步处理配置参数。HTTP请求只支持异步，必须设置为enable。

重要
缺少此请求头将报错：“current user api does not support synchronous calls”。

#### 请求体（Request Body）
model string （必选）

模型名称。示例值：wan2.2-kf2v-flash。

详情参见模型列表与价格。

input object （必选）

输入的基本信息，如提示词等。

属性

prompt string （可选）

文本提示词。支持中英文，长度不超过800个字符，每个汉字/字母占一个字符，超过部分会自动截断。

如果首尾帧的主体和场景变化较大，建议描写变化过程，例如运镜过程（镜头向左移动）、或者主体运动过程（人向前奔跑）。

示例值：一只黑色小猫好奇地看向天空，镜头从平视逐渐上升，最后俯拍它的好奇的眼神。

提示词的使用技巧请参见文生视频/图生视频Prompt指南。

negative_prompt string （可选）

反向提示词，用来描述不希望在视频画面中看到的内容，可以对视频画面进行限制。

支持中英文，长度不超过500个字符，超过部分会自动截断。

示例值：低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等。

first_frame_url string （必选）

首帧图像的URL或 Base64 编码数据。输出视频的宽高比将以此图像为基准。

图像限制：

图像格式：JPEG、JPG、PNG（不支持透明通道）、BMP、WEBP。

图像分辨率：图像的宽度和高度范围为[360, 2000]，单位为像素。

文件大小：不超过10MB。

输入图像说明：

使用公网可访问URL

支持 HTTP 或 HTTPS 协议。本地文件可通过上传文件获取临时URL。

示例值：https://wanx.alicdn.com/material/20250318/first_frame.png。

传入 Base64 编码图像后的字符串

数据格式：data:{MIME_type};base64,{base64_data}。

示例值：data:image/png;base64,GDU7MtCZzEbTbmRZ......。

具体参见输入图像。

last_frame_url string （可选）

尾帧图像的URL或 Base64 编码数据。

图像限制：

图像格式：JPEG、JPG、PNG（不支持透明通道）、BMP、WEBP。

图像分辨率：图像的宽度和高度范围为[360, 2000]，单位为像素。尾帧图像分辨率可与首帧不同，无需强制对齐。

文件大小：不超过10MB。

输入图像说明：

使用公网可访问URL

支持 HTTP 或 HTTPS 协议。本地文件可通过上传文件获取临时URL。

示例值：https://wanx.alicdn.com/material/20250318/last_frame.png。

使用 Base64 编码图像文件

数据格式：data:{MIME_type};base64,{base64_data}。

示例值：data:image/png;base64,VBORw0KGgoAAAANSUh......。（编码字符串过长，仅展示片段）

具体参见输入图像。

template string （可选）

视频特效模板的名称。使用此参数时，仅需传入 first_frame_url。

不同模型支持不同的特效模板。调用前请查阅视频特效列表，以免调用失败。

示例值：hufu-1，表示使用“唐韵翩然”特效。

parameters object （可选）

视频处理参数。

属性

resolution string （可选）

重要
resolution直接影响费用，同一模型：1080P > 720P > 480P，调用前请确认模型价格。

生成的视频分辨率档位。仅用于调整视频的清晰度（总像素），不改变视频的宽高比，视频宽高比将与首帧图像 first_frame_url 的宽高比保持一致。

此参数的默认值和可用枚举值依赖于 model 参数，规则如下：

wan2.2-kf2v-flash：可选值：480P、720P、1080P。默认值为720P。

wanx2.1-kf2v-plus：可选值：720P。默认值为720P。

示例值：720P。

duration integer （可选）

重要
duration直接影响费用，按秒计费，调用前请确认模型价格。

视频生成时长，单位为秒。当前参数值固定为5，且不支持修改。模型将始终生成5秒时长的视频。

prompt_extend bool （可选）

是否开启prompt智能改写。开启后使用大模型对输入prompt进行智能改写。对于较短的prompt生成效果提升明显，但会增加耗时。

true：默认值，开启智能改写。

false：不开启智能改写。

示例值：true。

watermark bool （可选）

是否添加水印标识，水印位于图片右下角，文案为“AI生成”。

false：默认值，不添加水印。

true：添加水印。

示例值：false。

seed integer （可选）

随机数种子。取值范围是[0, 2147483647]。

未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。

请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。

示例值：12345。

#### 首尾帧生视频
根据首帧、尾帧和prompt生成视频。

 
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wan2.2-kf2v-flash",
    "input": {
        "first_frame_url": "https://wanx.alicdn.com/material/20250318/first_frame.png",
        "last_frame_url": "https://wanx.alicdn.com/material/20250318/last_frame.png",
        "prompt": "写实风格，一只黑色小猫好奇地看向天空，镜头从平视逐渐上升，最后俯拍它的好奇的眼神。"
    },
    "parameters": {
        "resolution": "480P",
        "prompt_extend": true
    }
}'

#### 使用Base64
首帧first_frame_url和尾帧last_frame_url参数支持传入图像的 Base64 编码字符串。先下载first_frame_base64和last_frame_base64文件，并将完整内容粘贴至对应参数中。

格式参见输入图像。

 
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wanx2.1-kf2v-plus",
    "input": {
        "first_frame_url": "data:image/png;base64,GDU7MtCZzEbTbmRZ......",
        "last_frame_url": "data:image/png;base64,VBORw0KGgoAAAANSUh......",
        "prompt": "写实风格，一只黑色小猫好奇地看向天空，镜头从平视逐渐上升，最后俯拍它的好奇的眼神。"
    },
    "parameters": {
        "resolution": "720P",
        "prompt_extend": true
    }
}'

#### 使用视频特效
必须传入first_frame_url和template，无需传入prompt和last_frame_url。

不同模型支持不同的特效模板。调用前请查阅视频特效列表，以免调用失败。

 
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wanx2.1-kf2v-plus",
    "input": {
        "first_frame_url": "https://ty-yuanfang.oss-cn-hangzhou.aliyuncs.com/lizhengjia.lzj/tmp/11.png",
        "template": "hanfu-1"
    },
    "parameters": {
        "resolution": "720P",
        "prompt_extend": true
    }
}'

#### 使用反向提示词
通过 negative_prompt 指定生成的视频避免出现“人物”元素。

 
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis' \
    -H 'X-DashScope-Async: enable' \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
    "model": "wanx2.1-kf2v-plus",
    "input": {
        "first_frame_url": "https://wanx.alicdn.com/material/20250318/first_frame.png",
        "last_frame_url": "https://wanx.alicdn.com/material/20250318/last_frame.png",
        "prompt": "写实风格，一只黑色小猫好奇地看向天空，镜头从平视逐渐上升，最后俯拍它的好奇的眼神。",
        "negative_prompt": "人物"
    },
    "parameters": {
        "resolution": "720P",
        "prompt_extend": true
    }
}'


### 响应参数

output object

任务输出信息。

属性

task_id string

任务ID。查询有效期24小时。

task_status string

任务状态。

枚举值

PENDING：任务排队中

RUNNING：任务处理中

SUCCEEDED：任务执行成功

FAILED：任务执行失败

CANCELED：任务已取消

UNKNOWN：任务不存在或状态未知

request_id string

请求唯一标识。可用于请求明细溯源和问题排查。

code string

请求失败的错误码。请求成功时不会返回此参数，详情请参见错误信息。

message string

请求失败的详细信息。请求成功时不会返回此参数，详情请参见错误信息。

#### 成功效应
请保存 task_id，用于查询任务状态与结果。

 
{
    "output": {
        "task_status": "PENDING",
        "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx"
    },
    "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx"
}

#### 异常响应
创建任务失败，请参见错误信息进行解决。

 
{
    "code":"InvalidApiKey",
    "message":"Invalid API-key provided.",
    "request_id":"fb53c4ec-1c12-4fc4-a580-xxxxxx"
}