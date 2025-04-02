import os
from flask import Flask, render_template, jsonify

def create_app(bot_display_name):
    """Create and configure the Flask application"""
    app = Flask(__name__, static_folder='../static', template_folder='../templates')
    
    @app.route('/')
    def index():
        """Serve the main application page"""
        return render_template('index.html', bot_display_name=bot_display_name)
    
    @app.route('/api/config')
    def get_config():
        """API endpoint to get configuration for the client"""
        return jsonify({
            'bot_display_name': bot_display_name,
            'websocket_url': f'ws://localhost:{os.getenv("WEBSOCKET_PORT", "8765")}/ws'
        })
    
    return app

def run_flask_app(host, port, bot_display_name):
    """Run the Flask application"""
    app = create_app(bot_display_name)
    app.run(host=host, port=port, debug=False, use_reloader=False)
