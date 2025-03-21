
const fs = require("fs");
const axios = require("axios");
const express = require("express");
const app = express();


const urlget = "https://dev.azure.com/sin-chamba-team/TestProject/_apis/testplan/plans?api-version=7.1-preview.1";
const urlposttest = "https://dev.azure.com/sin-chamba-team/TestProject/_apis/wit/workitems/$Test%20Case?api-version=7.1-preview.3";


app.use(express.json());

app.post("/sc/migrate/test_cases", async (req, res) => {
    try {
        const token = "AfpxgFr4K27szgxW49mVI5aAH7AjSAvMTGTZJT6Azppnp4H4nm7cJQQJ99BBACAAAAAcetVYAAASAZDONKXj";
        const { organization, project, test_plan_id, test_suit_id, json_path } =  req.body;
        const json_data = readfile(json_path);

        const id_test_case = await postdata(json_data, token);
        settestcase(test_plan_id, test_suit_id, id_test_case, token);
        const result = {
            "message": "Test case creado con exito"
          };

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}); 

const port = 80;
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});




async function postdata(json_data, token) {
    try  {
        
        const post = await axios.post(urlposttest, json_data, {
            headers: {
                "Content-Type": "application/json-patch+json"
            },
            auth: {
                username: "", 
                password: token
            }
        });
        return post.data.id;         

    }
    catch (error) {
        console.error("Error en la solicitud POST:", error.response ? error.response.data : error.message);
    }
    
    
}




//
async function settestcase(id_test_plan, id_test_suit, id_test_case, token) {
    const urlpostset = `https://dev.azure.com/sin-chamba-team/TestProject/_apis/test/Plans/${id_test_plan}/suites/${id_test_suit}/testcases/${id_test_case}?api-version=7.1`; 
    try {
        const post = await axios.post(urlpostset, {}, {
            auth: {
                username: "", 
                password: token
            }
        });
        console.log(post.data); // Para ver la respuesta
    } catch (error) {
        console.error("Error en la solicitud POST:", error.response ? error.response.data : error.message);
    }
}


 function readfile(path){
     try {
        const data = fs.readFileSync(path, "utf-8");
        return data;
     }
     catch (err)
     {
        console.error("Error en la lectura del archivo:", err.message);
        return null;
     }

}




