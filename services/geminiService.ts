
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisRequest, AnalysisResponse, UserMode } from "../types";

const SYSTEM_INSTRUCTION = `
당신은 'North Star Universe'의 메인 AI 엔진입니다. 사용자의 상황을 분석하여 구체적인 성장 경로를 제시합니다. 모든 응답은 한국어로 작성하십시오.

---
[필수 원칙]
1. 말투: 정중한 존댓말(~해요, ~입니다)을 사용하십시오. 
2. 내용: 추상적인 문구보다는 당장 실행 가능한 '현실적인 실천 목록'과 '데이터 기반의 분석'을 제공하십시오.
3. **오각형 차트 (Attributes)**: gap_report.attributes는 반드시 **정확히 5개**의 항목으로 구성하십시오. (예: 기술력, 네트워킹, 자금력, 경험치, 학문적 깊이 등 모드에 적합한 5개 요소)
4. **목표 요건 분석 (Target Requirements)**: 사용자의 최종 목표를 위해 필요한 구체적인 리소스(학비, 자격증 비용, 필요 시간, 도구 등)를 4~5개 생성하십시오.
5. **격차 영향력 (Impact)**: missing_elements의 각 항목에 대해 해당 요소가 목표 달성을 위해 '왜' 중요한지 설명하는 impact 필드를 한국어로 상세히 작성하십시오.
6. **컨텍스트 반영**: 제공된 SurveyContext(이름, 관심사, 예산, 시간)를 최우선으로 고려하십시오.

---
### **MODE A: Dream Seed (3 ~ 13세)**
* **페르소나:** 아이의 성장을 돕는 다정한 멘토.
* **톤:** 아이와 부모가 함께할 수 있는 구체적인 활동 중심.

### **MODE B: Career Builder (19 ~ 29세)**
* **페르소나:** 냉철하지만 정중한 커리어 코치.
* **톤:** 기술 스택, 자격증, 취업 시장 트렌드 반영.

### **MODE C: Pro Navigator (30세 이상)**
* **페르소나:** 비즈니스 전략 컨설턴트.
* **톤:** 전문 용어 사용, 네트워킹, 리더십, MBA 등 고도화된 전략.

---
[출력 지침]
- 반드시 지정된 JSON 형식을 준수하며, 모든 텍스트는 한국어여야 합니다.
`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    user_mode: { type: Type.STRING },
    input_analysis: {
      type: Type.OBJECT,
      properties: {
        data_type: { type: Type.STRING },
        vision_summary: { type: Type.STRING },
        current_vector: { type: Type.STRING },
        target_vector: { type: Type.STRING }
      },
      required: ["data_type", "vision_summary", "current_vector", "target_vector"]
    },
    gap_report: {
      type: Type.OBJECT,
      properties: {
        similarity_score: { type: Type.NUMBER },
        gap_summary: { type: Type.STRING },
        missing_elements: { 
          type: Type.ARRAY, 
          items: { 
            type: Type.OBJECT,
            properties: {
              item: { type: Type.STRING },
              impact: { type: Type.STRING }
            },
            required: ["item", "impact"]
          } 
        },
        attributes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              current: { type: Type.NUMBER },
              target: { type: Type.NUMBER }
            },
            required: ["subject", "current", "target"]
          }
        }
      },
      required: ["similarity_score", "gap_summary", "missing_elements", "attributes"]
    },
    solution_card: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        action_type: { type: Type.STRING },
        quest: { type: Type.STRING },
        expected_result: { type: Type.STRING },
        roadmap: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              detail: { type: Type.STRING },
              status: { type: Type.STRING, enum: ["completed", "current", "upcoming"] },
              icon_type: { type: Type.STRING }
            },
            required: ["title", "description", "detail", "status", "icon_type"]
          }
        }
      },
      required: ["title", "action_type", "quest", "expected_result", "roadmap"]
    },
    target_requirements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: { type: Type.STRING },
          cost_or_condition: { type: Type.STRING },
          category: { type: Type.STRING }
        },
        required: ["item", "cost_or_condition", "category"]
      }
    },
    persona_message: { type: Type.STRING },
    required_info_guide: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["user_mode", "input_analysis", "gap_report", "solution_card", "target_requirements", "persona_message", "required_info_guide"]
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 4, initialDelay = 5000): Promise<T> => {
  let delay = initialDelay;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorStr = JSON.stringify(error).toLowerCase();
      if (i < retries && (errorStr.includes("429") || errorStr.includes("quota"))) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded.");
};

export const analyzeUserGap = async (request: AnalysisRequest): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let userContextText = "";
  if (request.surveyContext) {
    userContextText = `
[사용자 배경 컨텍스트]
- 이름: ${request.surveyContext.name}
- 생애 주기: ${request.surveyContext.ageGroup}
- 주요 관심사: ${request.surveyContext.field}
- 예산 수준: ${request.surveyContext.budgetLevel}
- 가용 시간: ${request.surveyContext.availableTime}
- 최종 꿈: ${request.surveyContext.ultimateGoal}
`;
  }

  const contents: any[] = [{ 
    text: `${userContextText}\n\n사용자 입력: ${request.text}${request.mode ? ` (모드: ${request.mode})` : ''}` 
  }];

  if (request.image) {
    contents.push({ inlineData: { mimeType: 'image/jpeg', data: request.image.split(',')[1] || request.image } });
  }

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: { parts: contents },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const text = response.text;
    if (!text) throw new Error("분석 응답을 받지 못했습니다.");
    return JSON.parse(text) as AnalysisResponse;
  });
};
