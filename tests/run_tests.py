#!/usr/bin/env python3
import unittest
import subprocess
import sys
import os

def run_server_tests():
    """Run the server-side tests"""
    print("Running server-side tests...")
    
    loader = unittest.TestLoader()
    suite = loader.discover('tests', pattern='test_transcript_*.py')
    
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    return result.wasSuccessful()

def run_frontend_tests():
    """Run the frontend tests using Jest"""
    print("Running frontend tests...")
    
    try:
        subprocess.run(['npm', '--version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: npm is not installed. Please install npm to run frontend tests.")
        return False
    
    try:
        subprocess.run(['npm', 'install'], check=True)
    except subprocess.CalledProcessError:
        print("Error: Failed to install npm dependencies.")
        return False
    
    try:
        result = subprocess.run(['npm', 'test'], check=True)
        return result.returncode == 0
    except subprocess.CalledProcessError:
        return False

def main():
    """Run all tests"""
    print("Running all tests for AI Operator transcript functionality")
    
    server_success = run_server_tests()
    
    frontend_success = run_frontend_tests()
    
    if server_success and frontend_success:
        print("All tests passed successfully!")
        return 0
    else:
        print("Some tests failed.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
