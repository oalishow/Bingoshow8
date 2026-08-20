try {
  console.log("Testing error");
  throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", "SecurityError");
} catch(e) {
  console.log("Caught:", e.message);
}
