from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage


class LLMClient:
    
    def __init__(self, base_url: str, api_key: str, model: str,temperature : float = 0.0):
        
        self.model = ChatOpenAI(
            base_url=base_url,
            api_key=api_key,
            model=model,
            temperature=temperature,
        )


    @staticmethod
    def _to_lc(messages: list):

        mapping = {"system": SystemMessage, "user": HumanMessage, "assistant": AIMessage}
        
        return [mapping[m["role"]](content=m["content"]) for m in messages]



    def chat(self, messages: list):
        return (self.model.invoke(self._to_lc(messages)).content or "").strip()