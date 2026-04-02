import urllib.parse
import base64
import json

def generate_google_earth_link(kmz_url):
    """
    Generates a Google Earth Web link that explicitly fetches a KML/KMZ from a public URL.
    
    Args:
        kmz_url (str): The public URL of the KMZ or KML file.
        
    Returns:
        str: A URL with a base64-encoded JSON state that tells Google Earth to fetch the KMZ.
    """
    # 1. Create a state object that Google Earth Web understands
    # This structure tell Google Earth to "fetch" a remote project from the URL
    state = {
        "recentProjects": {
            "source": {
                "url": kmz_url,
                "type": "fetch"
            }
        }
    }
    
    # 2. Convert the state to a JSON string and base64-encode it
    state_json = json.dumps(state)
    state_b64 = base64.b64encode(state_json.encode('utf-8')).decode('utf-8')
    
    # 3. Construct the Google Earth URL with the state parameter
    # The 'data=mk_viewer' specifies we are using the project viewer mode
    google_earth_url = f"https://earth.google.com/web/data=mk_viewer?state={state_b64}"
    
    return google_earth_url

if __name__ == "__main__":
    # Example usage:
    # Replace this with your actual public KMZ URL (Google Earth needs it to be public to fetch it)
    sample_url = "https://raw.githubusercontent.com/googlearchive/kml-samples/master/kml/Time_Span/Time_Span_Example.kml"
    
    link = generate_google_earth_link(sample_url)
    
    print("\n--- Google Earth Direct Link Generator ---")
    print(f"Input KMZ URL:  {sample_url}")
    print(f"Generated Link: {link}")
    print("\nIMPORTANT: The KMZ file must be hosted on a PUBLIC server (Google Cloud Storage, AWS S3, GitHub, etc.) for Google Earth to load it.")
    print("Google Earth Web fetches the file from your server; it cannot access your C:\\ local drive.")
