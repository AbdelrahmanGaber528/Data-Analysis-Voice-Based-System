from .BaseController import BaseController
from .ItemController import ItemController
import os
from models import ProcessExtension

from langchain_community.document_loaders import TextLoader
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_community.document_loaders import CSVLoader
from langchain_community.document_loaders import UnstructuredExcelLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter



class ProcessController(BaseController):
    
    def __init__(self , item_id : str):
        
        super().__init__()
        
        self.item_id = item_id
        self.item_controller = ItemController()
        self.item_path = self.item_controller.get_item_path(item_id)
        
        
    
    def get_file_extension(self , file_id : str):
        
        return os.path.splitext(file_id)[-1]
    
    
    
    def get_file_loader(self , file_id : str):
        
        file_extenstion = self.get_file_extension(file_id=file_id)
        
        file_path = os.path.join(
            self.item_path, file_id
        )
        
        
        
        if file_extenstion == ProcessExtension.TXT :
            
            return TextLoader(file_path=file_path , encoding="utf-8")
        
        if file_extenstion == ProcessExtension.PDF :
            
            return PyMuPDFLoader(file_path=file_path)
        
        
        if file_extenstion == ProcessExtension.XLSX :
            
            return UnstructuredExcelLoader(file_path=file_path)
        
        if file_extenstion == ProcessExtension.CSV : 
            
            return CSVLoader(file_path=file_path)
        
        return None
    
    
    
    def get_file_content( self , file_id : str):
        
        loader = self.get_file_loader(file_id=file_id)
        
        return loader.load()
    
    
    def process_file_content(self , file_content : list , file_id : str , chunk_size : int = 100 , overlap_size : int = 20):
        
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=overlap_size,
            length_function=len # to determine when 100 chunk achived , how to length the chunks .
        )
        
        file_content_texts = [ record.page_content for record in file_content]
        
        file_content_metadata = [ record.metadata for record in file_content]
        
        
        chunks = text_splitter.create_documents(
            file_content_texts,
            metadatas=file_content_metadata,
        )
        
        
        return chunks