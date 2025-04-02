import os
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

def create_app(bot_display_name):
    """Create and configure the FastAPI application"""
    app = FastAPI(title="AI Operator")
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Mount static files directory
    app.mount("/static", StaticFiles(directory="static"), name="static")
    
    # Set up templates
    templates = Jinja2Templates(directory="templates")
    
    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        """Serve the main application page"""
        return templates.TemplateResponse(
            "index.html", 
            {"request": request, "bot_display_name": bot_display_name}
        )
    
    @app.get("/api/config")
    async def get_config():
        """API endpoint to get configuration for the client"""
        return JSONResponse({
            'bot_display_name': bot_display_name,
            'websocket_url': f'ws://localhost:{os.getenv("WEBSOCKET_PORT", "8765")}/ws'
        })
    
    return app

def run_web_app(host, port, bot_display_name):
    """Run the web application"""
    app = create_app(bot_display_name)
    uvicorn.run(app, host=host, port=port, log_level="info")
